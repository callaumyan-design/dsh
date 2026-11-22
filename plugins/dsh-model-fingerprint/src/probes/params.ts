/**
 * Parameter compliance (medium evidence): exact max_tokens truncation, stop
 * sequences, temperature=0 stability, tool-call wire format, logprobs. A
 * relay that rewrites or drops parameters — or a substitute model with
 * different capabilities — shows up as behavior the official API would not
 * produce. The opt-in context-limit test lives in its own probe.
 */
import { isNativeProtocol, isOpenAIReasoningModel, isReasoningModel, tiktokenEncodingFor } from '../models.ts'
import { isSingleToken } from '../tokenizer.ts'
import type { Evidence, GenerationResult } from '../types.ts'
import { idPattern, meanPairwiseSimilarity, round } from '../util.ts'
import { req, times, type PlanContext, type Probe, type ProbeContext, type ProbeOutput } from './types.ts'

const CAP = 17
const CAP_PROMPT = 'Count from 1 to 200, separated by single spaces. Output only the numbers.'
const STOP_PROMPT = 'Output exactly the following text and nothing else: alpha beta gamma delta epsilon'
const TEMP_PROMPT = 'Write one vivid sentence about a lighthouse keeper.'
const TOOL_PROMPT = 'What is the weather in Paris right now? Use the get_weather tool.'
const LOGPROB_PROMPT = 'Say exactly: the sky is blue'

export const WEATHER_TOOL = {
  name: 'get_weather',
  description: 'Get the current weather for a city.',
  parameters: { type: 'object', properties: { city: { type: 'string', description: 'City name' } }, required: ['city'] },
}

/** Extra output room for models that spend hidden reasoning tokens before answering. */
export function headroom(ctx: Pick<PlanContext, 'claimedModel'>, base: number): number {
  return isReasoningModel(ctx.claimedModel) ? base + 512 : base
}

function effort(ctx: Pick<PlanContext, 'claimedModel' | 'vendor'>): { reasoningEffort?: 'low' } {
  return ctx.vendor === 'openai' && isOpenAIReasoningModel(ctx.claimedModel) ? { reasoningEffort: 'low' } : {}
}

function stopSupported(ctx: PlanContext): boolean {
  return ctx.targetProtocol !== 'openai-responses' && !(ctx.vendor === 'openai' && isOpenAIReasoningModel(ctx.claimedModel))
}

function temperatureSupported(ctx: PlanContext): boolean {
  return !(ctx.vendor === 'openai' && isOpenAIReasoningModel(ctx.claimedModel))
}

function logprobsApplicable(ctx: PlanContext): boolean {
  return ctx.targetProtocol === 'openai-completions' && ctx.vendor === 'openai'
}

function ev(probe: string, strength: Evidence['strength'], result: Evidence['result'], detail: string, raw: unknown): Evidence {
  return { probe: `params.${probe}`, strength, result, detail, raw, category: 'parameters' }
}

/** Only a 400/422 answer means "this parameter was refused"; auth, rate-limit and server errors say nothing. */
export function isParamRejection(r: GenerationResult): boolean {
  return !r.ok && (r.status === 400 || r.status === 422)
}

function brief(r: GenerationResult): unknown {
  return { status: r.status, stop: r.stopReason, usage: r.usage, text: r.text.slice(0, 200), error: r.error }
}

export function evaluateMaxTokens(r: GenerationResult): Evidence {
  if (!r.ok) return ev('max_tokens', 'medium', 'inconclusive', `请求失败：HTTP ${r.status} ${r.error?.message ?? ''}`, brief(r))
  const out = r.usage.outputTokens
  if (out === undefined) return ev('max_tokens', 'medium', 'inconclusive', '未返回输出 token 用量，无法验证截断。', brief(r))
  if (out > CAP) {
    const visible = out - (r.usage.reasoningTokens ?? 0)
    if ((r.usage.reasoningTokens ?? 0) > 0 && visible <= CAP) {
      return ev('max_tokens', 'weak', 'inconclusive', `输出 ${out} tokens 中含 ${r.usage.reasoningTokens} 个思考 token，可见部分 ${visible} ≤ ${CAP}：该端点把思考 token 记在上限之外，无法判断。`, brief(r))
    }
    return ev('max_tokens', 'medium', 'mismatch', `max_tokens=${CAP} 未生效：实际输出 ${out} tokens（参数可能被中转站改写）。`, brief(r))
  }
  if (r.stop === 'length') return ev('max_tokens', 'medium', 'match', `max_tokens=${CAP} 精确截断：输出 ${out} tokens，stop=${r.stopReason}。`, brief(r))
  return ev('max_tokens', 'weak', 'inconclusive', `输出 ${out} tokens 后自然结束（stop=${r.stopReason ?? '?'}），未触发截断。`, brief(r))
}

export function evaluateStop(r: GenerationResult, expectSupported: boolean, protocolIsAnthropic: boolean): Evidence {
  const lower = r.text.toLowerCase()
  if (!r.ok) {
    if (!isParamRejection(r)) return ev('stop', 'weak', 'inconclusive', `stop 请求失败（HTTP ${r.status} ${r.error?.message ?? ''}），与参数无关。`, brief(r))
    if (!expectSupported) return ev('stop', 'weak', 'match', `目标拒绝了 stop 参数（HTTP ${r.status}），与官方对该模型的行为一致。`, brief(r))
    return ev('stop', 'weak', 'mismatch', `目标拒绝了官方支持的 stop 参数：HTTP ${r.status} ${r.error?.message ?? ''}`, brief(r))
  }
  const honored = lower.includes('alpha') && !lower.includes('gamma') && !lower.includes('delta')
  const ignored = lower.includes('delta') || lower.includes('epsilon') || lower.includes('gamma')
  if (!expectSupported) {
    if (honored) return ev('stop', 'medium', 'mismatch', '官方该模型不支持 stop，但目标接受并执行了它：后端很可能不是声称的推理模型。', brief(r))
    return ev('stop', 'weak', 'mismatch', '官方该模型会拒绝 stop 参数，但目标静默接受（中转站可能吞掉了参数）。', brief(r))
  }
  if (ignored) return ev('stop', 'medium', 'mismatch', `stop=["gamma"] 未生效，输出：${r.text.slice(0, 80)}`, brief(r))
  if (honored) {
    const reasonOk = !protocolIsAnthropic || r.stopReason === 'stop_sequence'
    return ev('stop', reasonOk ? 'medium' : 'weak', reasonOk ? 'match' : 'inconclusive', reasonOk ? `stop 序列生效，stop=${r.stopReason}${r.stopSequence ? `（${r.stopSequence}）` : ''}。` : `输出在 gamma 前截止，但 stop_reason=${r.stopReason}（官方应为 stop_sequence）。`, brief(r))
  }
  return ev('stop', 'weak', 'inconclusive', `模型没有按要求复述，无法判断：${r.text.slice(0, 80)}`, brief(r))
}

export function evaluateTemperature(allTexts: string[], referenceSim: number | undefined, label: string): Evidence {
  // Empty outputs (e.g. the cap spent on thinking) would look perfectly "stable"; ignore them.
  const texts = allTexts.filter(t => t.trim().length > 0)
  const sim = meanPairwiseSimilarity(texts)
  const identical = texts.filter(t => t === texts[0]).length
  const raw = { similarity: round(sim, 3), identical, n: texts.length, referenceSimilarity: round(referenceSim, 3), samples: texts.map(t => t.slice(0, 160)) }
  if (texts.length < 2) return ev('temperature', 'weak', 'inconclusive', '样本不足（samples < 2），无法评估 temperature=0 稳定性。', raw)
  if (referenceSim !== undefined) {
    if (sim >= Math.min(0.9, referenceSim - 0.15)) return ev('temperature', 'medium', 'match', `temperature=0 稳定性 ${sim.toFixed(2)}，与${label} ${referenceSim.toFixed(2)} 相当。`, raw)
    if (sim < referenceSim - 0.35 && sim < 0.6) return ev('temperature', 'medium', 'mismatch', `temperature=0 下输出差异大（相似度 ${sim.toFixed(2)}，${label} ${referenceSim.toFixed(2)}），temperature 可能被改写。`, raw)
    return ev('temperature', 'weak', 'inconclusive', `temperature=0 稳定性 ${sim.toFixed(2)}，${label} ${referenceSim.toFixed(2)}。`, raw)
  }
  if (sim >= 0.85) return ev('temperature', 'medium', 'match', `temperature=0 下 ${texts.length} 次输出高度一致（相似度 ${sim.toFixed(2)}，${identical} 次完全相同）。`, raw)
  if (sim < 0.45) return ev('temperature', 'medium', 'mismatch', `temperature=0 下输出差异很大（相似度 ${sim.toFixed(2)}），temperature 参数可能被改写。`, raw)
  return ev('temperature', 'weak', 'inconclusive', `temperature=0 稳定性一般（相似度 ${sim.toFixed(2)}）。`, raw)
}

export function evaluateToolCall(r: GenerationResult, ctx: Pick<PlanContext, 'vendor' | 'targetProtocol'>): Evidence {
  if (!r.ok) return ev('tool_call', 'medium', 'inconclusive', `工具调用请求失败：HTTP ${r.status} ${r.error?.message ?? ''}`, brief(r))
  const call = r.toolCalls[0]
  const raw = { toolCalls: r.toolCalls, stop: r.stopReason, idPattern: idPattern(call?.id), itemIdPattern: idPattern(call?.itemId) }
  if (!call && r.stop === 'length') return ev('tool_call', 'weak', 'inconclusive', '输出在给出工具调用前达到上限（可能被思考 token 占满），无法判断。', raw)
  if (!call) return ev('tool_call', 'medium', 'mismatch', '强制 tool_choice 后没有返回工具调用。', raw)
  const problems: string[] = []
  if (call.name !== WEATHER_TOOL.name) problems.push(`函数名为 ${call.name ?? '缺失'}`)
  let args: unknown = call.arguments
  const stringArgs = ctx.targetProtocol === 'openai-completions' || ctx.targetProtocol === 'openai-responses'
  if (stringArgs) {
    if (typeof args !== 'string') problems.push('arguments 不是 JSON 字符串')
    else { try { args = JSON.parse(args) } catch { problems.push('arguments 不是合法 JSON') } }
  } else if (typeof args !== 'object' || args === null) problems.push('参数不是对象')
  if (typeof args === 'object' && args !== null && typeof (args as Record<string, unknown>).city !== 'string') problems.push('缺少 city 参数')
  if (isNativeProtocol(ctx.vendor, ctx.targetProtocol)) {
    if (ctx.targetProtocol === 'anthropic-messages' && !/^toolu_[A-Za-z0-9]{10,}$/.test(call.id ?? '')) problems.push(`tool_use id 不是 toolu_ 前缀（${idPattern(call.id) ?? '缺失'}）`)
    if (ctx.targetProtocol === 'openai-completions' && !/^call_[A-Za-z0-9]{10,}$/.test(call.id ?? '')) problems.push(`tool_call id 不是 call_ 前缀（${idPattern(call.id) ?? '缺失'}）`)
    if (ctx.targetProtocol === 'openai-responses' && (!/^call_/.test(call.id ?? '') || !/^fc_/.test(call.itemId ?? ''))) problems.push(`function_call id 格式不符（call_id ${idPattern(call.id) ?? '缺失'}，id ${idPattern(call.itemId) ?? '缺失'}）`)
    if (ctx.targetProtocol === 'anthropic-messages' && r.stopReason !== 'tool_use') problems.push(`stop_reason=${r.stopReason}（应为 tool_use）`)
  }
  if (problems.length > 0) return ev('tool_call', 'medium', 'mismatch', `工具调用格式与官方不符：${problems.join('；')}`, raw)
  return ev('tool_call', 'medium', 'match', `工具调用格式符合${isNativeProtocol(ctx.vendor, ctx.targetProtocol) ? '官方' : '协议'}规范（id ${idPattern(call.id) ?? '-'}）。`, raw)
}

export async function evaluateLogprobs(r: GenerationResult, expectSupported: boolean, model: string): Promise<Evidence> {
  if (!r.ok && !isParamRejection(r)) return ev('logprobs', 'weak', 'inconclusive', `logprobs 请求失败（HTTP ${r.status} ${r.error?.message ?? ''}），与参数无关。`, brief(r))
  if (!expectSupported) {
    if (!r.ok) return ev('logprobs', 'weak', 'match', `目标拒绝了 logprobs（HTTP ${r.status}），与官方对推理模型的行为一致。`, brief(r))
    if (r.logprobs && r.logprobs.length > 0) return ev('logprobs', 'medium', 'mismatch', '官方该模型不支持 logprobs，但目标返回了 logprobs：后端很可能不是声称的模型。', brief(r))
    return ev('logprobs', 'weak', 'mismatch', '官方该模型会拒绝 logprobs，但目标静默接受（参数可能被吞掉）。', brief(r))
  }
  if (!r.ok) return ev('logprobs', 'medium', 'mismatch', `官方支持 logprobs，但目标报错：HTTP ${r.status} ${r.error?.message ?? ''}`, brief(r))
  if (!r.logprobs || r.logprobs.length === 0) return ev('logprobs', 'medium', 'mismatch', '请求了 logprobs，但目标没有返回（官方会返回逐 token 对数概率）。', brief(r))
  const enc = tiktokenEncodingFor(model)
  const tokens = r.logprobs.map(t => t.token).filter(t => t.length > 0 && /^[\x20-\x7e]+$/.test(t))
  if (tokens.length < 3) return ev('logprobs', 'weak', 'inconclusive', 'logprobs 中可检查的 ASCII token 太少。', { tokens })
  let single = 0
  for (const t of tokens) if (await isSingleToken(enc, t)) single++
  const frac = single / tokens.length
  const raw = { tokens, singleTokenFraction: round(frac, 3), encoding: enc }
  if (frac >= 0.8) return ev('logprobs', 'medium', 'match', `logprobs 的 token 切分与 ${enc} 一致（${single}/${tokens.length}）。`, raw)
  if (frac < 0.5) return ev('logprobs', 'medium', 'mismatch', `logprobs 的 token 不是 ${enc} 的单个 token（仅 ${single}/${tokens.length}），分词器不同。`, raw)
  return ev('logprobs', 'weak', 'inconclusive', `logprobs token 与 ${enc} 部分一致（${single}/${tokens.length}）。`, raw)
}

export const paramsProbe: Probe = {
  id: 'params',
  title: '参数合规',

  plan(ctx) {
    const plan = [req('target', 'params', 30, CAP), req('target', 'params', 120, headroom(ctx, 40))]
    if (ctx.targetProtocol !== 'openai-responses') plan.push(req('target', 'params', 30, headroom(ctx, 30)))
    plan.push(...times(temperatureSupported(ctx) ? ctx.samples : 1, () => req('target', 'params', 20, headroom(ctx, 48))))
    if (logprobsApplicable(ctx)) plan.push(req('target', 'params', 20, headroom(ctx, 8)))
    if (ctx.mode === 'verify' && ctx.hasReference && temperatureSupported(ctx)) plan.push(...times(ctx.samples, () => req('reference', 'params', 20, headroom(ctx, 48))))
    return plan
  },

  async run(ctx: ProbeContext): Promise<ProbeOutput> {
    const evidence: Evidence[] = []
    const reasoning = ctx.vendor === 'openai' && isOpenAIReasoningModel(ctx.claimedModel)
    const t = ctx.target
    const baselineParams = ctx.baseline?.params as Record<string, unknown> | undefined

    const cap = await t.generate('params', { user: CAP_PROMPT, maxTokens: CAP }, ctx.signal)
    evidence.push(evaluateMaxTokens(cap))

    if (ctx.targetProtocol !== 'openai-responses') {
      const stop = await t.generate('params', { user: STOP_PROMPT, maxTokens: headroom(ctx, 30), stop: ['gamma'], ...temperatureSupported(ctx) ? { temperature: 0 } : {} }, ctx.signal)
      evidence.push(evaluateStop(stop, stopSupported(ctx), ctx.targetProtocol === 'anthropic-messages'))
    } else {
      evidence.push(ev('stop', 'weak', 'inconclusive', 'OpenAI Responses 协议没有 stop 参数，跳过。', null))
    }

    let tempSim: number | undefined
    if (temperatureSupported(ctx)) {
      const texts: string[] = []
      for (let i = 0; i < ctx.samples; i++) {
        const r = await t.generate('params', { user: TEMP_PROMPT, maxTokens: headroom(ctx, 48), temperature: 0 }, ctx.signal)
        if (r.ok) texts.push(r.text)
      }
      tempSim = meanPairwiseSimilarity(texts)
      let refSim: number | undefined
      let label = '官方参考端点'
      if (ctx.mode === 'verify' && ctx.reference) {
        const refTexts: string[] = []
        for (let i = 0; i < ctx.samples; i++) {
          const r = await ctx.reference.generate('params', { user: TEMP_PROMPT, maxTokens: headroom(ctx, 48), temperature: 0 }, ctx.signal)
          if (r.ok && r.text.trim()) refTexts.push(r.text)
        }
        if (refTexts.length >= 2) refSim = meanPairwiseSimilarity(refTexts)
      } else if (typeof baselineParams?.temperature0Similarity === 'number') {
        refSim = baselineParams.temperature0Similarity
        label = '基线'
      }
      if (ctx.mode === 'verify') evidence.push(evaluateTemperature(texts, refSim, label))
    } else {
      const r = await t.generate('params', { user: TEMP_PROMPT, maxTokens: headroom(ctx, 48), temperature: 0 }, ctx.signal)
      if (!r.ok && !isParamRejection(r)) evidence.push(ev('temperature', 'weak', 'inconclusive', `请求失败（HTTP ${r.status}），与参数无关。`, brief(r)))
      else if (!r.ok) evidence.push(ev('temperature', 'weak', 'match', `目标拒绝 temperature=0（HTTP ${r.status}），与官方推理模型行为一致。`, brief(r)))
      else if ((r.usage.reasoningTokens ?? 0) > 0) evidence.push(ev('temperature', 'weak', 'mismatch', '官方该推理模型不接受 temperature=0，目标却接受（中转站可能吞掉了参数）；响应含推理 token。', brief(r)))
      else evidence.push(ev('temperature', 'medium', 'mismatch', '官方该推理模型不接受 temperature=0，目标接受且没有推理 token：后端可能不是推理模型。', brief(r)))
    }

    const tool = await t.generate('params', { user: TOOL_PROMPT, maxTokens: headroom(ctx, 40), tools: [WEATHER_TOOL], toolChoice: { name: WEATHER_TOOL.name }, ...effort(ctx) }, ctx.signal)
    evidence.push(evaluateToolCall(tool, ctx))

    if (logprobsApplicable(ctx)) {
      const lp = await t.generate('params', { user: LOGPROB_PROMPT, maxTokens: reasoning ? headroom(ctx, 8) : 8, topLogprobs: 2, ...reasoning ? effort(ctx) : { temperature: 0 } }, ctx.signal)
      evidence.push(await evaluateLogprobs(lp, !reasoning, ctx.claimedModel))
    }

    if (ctx.mode === 'record') {
      ctx.record.params = { maxTokensOutput: cap.usage.outputTokens, maxTokensStop: cap.stopReason, temperature0Similarity: tempSim, toolCallIdPattern: idPattern(tool.toolCalls[0]?.id) }
      return { evidence: [], summary: '已记录参数行为', data: ctx.record.params }
    }
    const ok = evidence.filter(e => e.result === 'match').length
    const bad = evidence.filter(e => e.result === 'mismatch').length
    return { evidence, summary: `${ok} 项符合，${bad} 项不符`, data: undefined }
  },
}
