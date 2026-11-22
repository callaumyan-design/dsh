/**
 * Signature replay (opt-in; needs an official reference key).
 *
 * The target is asked for a signed reasoning artifact — a Claude thinking
 * block signature, an OpenAI Responses `encrypted_content`, or a Gemini
 * `thoughtSignature` — which is then replayed inside a multi-turn request to
 * the OFFICIAL API, which verifies it.
 *
 * No error code is hard-coded. Each run first calibrates against the
 * official API's live behavior:
 *   positive control — an artifact the official API just issued, replayed
 *                      unchanged, must be accepted;
 *   negative control — the same artifact with its signature altered, must be
 *                      rejected; its status/error type define "rejected".
 * Only when both controls behave is the target's artifact classified: accepted
 * → produced by the vendor (strong match); rejected like the negative control
 * → not produced by the vendor (mismatch); anything else → inconclusive.
 */
import { isOpenAIReasoningModel } from '../models.ts'
import type { GenerateParams } from '../protocols/index.ts'
import type { Endpoint } from '../endpoint.ts'
import type { Evidence, GenerationResult, SignatureArtifact, Strength } from '../types.ts'
import { isRecord, ngramSimilarity } from '../util.ts'
import { WEATHER_TOOL } from './params.ts'
import { req, type PlanContext, type Probe, type ProbeContext, type ProbeOutput } from './types.ts'

const TOOL_PROMPT = 'What is the weather in Paris right now? Use the get_weather tool.'
const MATH_PROMPT = 'Briefly reason, then answer: what is 17 * 23? Reply with the number.'
const FOLLOW_UP = 'Add 1 to that. Reply with only the number.'
const TOOL_RESULT = 'Sunny, 22°C'
const BUDGET = 1024

type Kind = SignatureArtifact['kind']

export interface ReplayOutcome {
  accepted: boolean
  status: number
  errorType?: string
  errorCode?: string
  message?: string
}

export function outcomeOf(r: GenerationResult): ReplayOutcome {
  return {
    accepted: r.ok,
    status: r.status,
    ...r.error?.type ? { errorType: r.error.type } : {},
    ...r.error?.code ? { errorCode: r.error.code } : {},
    ...r.error?.message ? { message: r.error.message.slice(0, 300) } : {},
  }
}

function normalizeMessage(message: string | undefined): string {
  return (message ?? '').toLowerCase().replace(/[`'"].*?[`'"]/g, '').replace(/[0-9a-f]{6,}|\d+/g, '#').slice(0, 200)
}

/** Whether two rejections are the same kind of rejection (status plus error type or wording). */
export function sameRejection(a: ReplayOutcome, b: ReplayOutcome): boolean {
  if (a.accepted || b.accepted || a.status !== b.status) return false
  if (a.errorType !== undefined && a.errorType === b.errorType && a.errorCode === b.errorCode) return true
  const ma = normalizeMessage(a.message)
  const mb = normalizeMessage(b.message)
  return ma.length > 0 && mb.length > 0 && ngramSimilarity(ma, mb) >= 0.6
}

/** Decide from the calibrated controls; mismatch strength depends on how account-independent the signature is. */
export function classifyReplay(positive: ReplayOutcome, negative: ReplayOutcome, test: ReplayOutcome, kind: Kind, mismatchStrength: Strength): Evidence {
  const raw = { kind, positive, negative, test }
  const base = { probe: 'signature.replay', category: 'substitution' as const, raw }
  if (!positive.accepted) {
    return { ...base, strength: 'strong', result: 'inconclusive', detail: `校准失败：官方 API 不接受它自己刚签发的 ${kind} 回放（HTTP ${positive.status} ${positive.message ?? ''}），无法据此判断。` }
  }
  if (negative.accepted) {
    return { ...base, strength: 'strong', result: 'inconclusive', detail: `校准失败：篡改后的签名也被官方接受，该模型/格式下官方不校验 ${kind}。` }
  }
  if (test.accepted) {
    return { ...base, strength: 'strong', result: 'match', detail: `目标返回的 ${kind} 通过了官方 API 校验：该响应由官方模型生成（不能区分同厂商的不同型号）。` }
  }
  if (sameRejection(test, negative)) {
    return { ...base, strength: mismatchStrength, result: 'mismatch', detail: `目标返回的 ${kind} 被官方 API 拒绝，拒绝方式与篡改签名的负对照一致（HTTP ${test.status}${test.errorType ? ` ${test.errorType}` : ''}）：签名不是官方签发的。` }
  }
  return { ...base, strength: 'strong', result: 'inconclusive', detail: `目标的 ${kind} 被拒绝，但错误形态与负对照不同（目标 HTTP ${test.status} ${test.errorType ?? ''}，负对照 HTTP ${negative.status} ${negative.errorType ?? ''}），不下结论。` }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Alter a signature in place (same length and alphabet) so only its validity changes. */
export function mutateSignature(value: string): string {
  if (value.length < 12) return `${value}A`
  const chars = [...value]
  const start = Math.floor(chars.length / 2) - 4
  for (let i = start; i < start + 8; i++) {
    const c = chars[i] as string
    const idx = B64.indexOf(c)
    chars[i] = idx < 0 ? c : B64[(idx + 17) % 64] as string
  }
  return chars.join('')
}

function kindFor(ctx: PlanContext): Kind | undefined {
  if (ctx.vendor === 'anthropic' && ctx.targetProtocol === 'anthropic-messages' && ctx.referenceProtocol === 'anthropic-messages') return 'anthropic-thinking'
  if (ctx.vendor === 'openai' && ctx.targetProtocol === 'openai-responses' && ctx.referenceProtocol === 'openai-responses' && isOpenAIReasoningModel(ctx.claimedModel)) return 'openai-encrypted-reasoning'
  if (ctx.vendor === 'google' && ctx.targetProtocol === 'google-generative-ai' && ctx.referenceProtocol === 'google-generative-ai') return 'gemini-thought-signature'
  return undefined
}

function elicitParams(kind: Kind, style: 'enabled' | 'adaptive'): GenerateParams {
  switch (kind) {
    case 'anthropic-thinking': return { user: TOOL_PROMPT, maxTokens: BUDGET + 512, thinking: { budgetTokens: BUDGET, style }, tools: [WEATHER_TOOL], toolChoice: 'auto' }
    case 'openai-encrypted-reasoning': return { user: MATH_PROMPT, maxTokens: 512, reasoningEffort: 'low', includeEncryptedReasoning: true }
    case 'gemini-thought-signature': return { user: TOOL_PROMPT, maxTokens: 1024, thinking: { budgetTokens: 512 }, tools: [WEATHER_TOOL], toolChoice: 'auto' }
  }
}

async function elicit(ep: Endpoint, kind: Kind, ctx: ProbeContext): Promise<{ result: GenerationResult; artifact?: SignatureArtifact; style: 'enabled' | 'adaptive' }> {
  let style = ctx.thinkingStyle
  let result = await ep.generate('signature', elicitParams(kind, style), ctx.signal)
  // Newer Claude models may only take adaptive thinking; follow what the API says instead of guessing.
  if (kind === 'anthropic-thinking' && !result.ok && result.status === 400 && /adaptive/i.test(result.error?.message ?? '')) {
    style = style === 'enabled' ? 'adaptive' : 'enabled'
    result = await ep.generate('signature', elicitParams(kind, style), ctx.signal)
  }
  const artifact = result.signatures.find(s => s.kind === kind)
  return { result, ...artifact ? { artifact } : {}, style }
}

/** Replace the signature inside the artifact's native items. */
export function withSignature(artifact: SignatureArtifact, signature: string): SignatureArtifact {
  const items = structuredClone(artifact.items) as unknown[]
  let replaced = false
  for (const item of items) {
    if (!isRecord(item) || replaced) continue
    if (artifact.kind === 'anthropic-thinking' && (item.type === 'thinking' || item.type === 'redacted_thinking')) {
      if (typeof item.signature === 'string') { item.signature = signature; replaced = true }
      else if (typeof item.data === 'string') { item.data = signature; replaced = true }
    }
    if (artifact.kind === 'openai-encrypted-reasoning' && typeof item.encrypted_content === 'string') { item.encrypted_content = signature; replaced = true }
    if (artifact.kind === 'gemini-thought-signature' && typeof item.thoughtSignature === 'string') { item.thoughtSignature = signature; replaced = true }
  }
  return { ...artifact, value: signature, items }
}

/** Build the multi-turn replay request for the official API. */
export function replayParams(artifact: SignatureArtifact, assistantText: string, style: 'enabled' | 'adaptive'): GenerateParams | undefined {
  if (artifact.kind === 'anthropic-thinking') {
    const toolUse = artifact.items.filter(isRecord).find(b => b.type === 'tool_use')
    if (!toolUse || typeof toolUse.id !== 'string') return undefined
    return {
      user: '', maxTokens: BUDGET + 76, thinking: { budgetTokens: BUDGET, style }, tools: [WEATHER_TOOL], toolChoice: 'auto',
      nativeMessages: [
        { role: 'user', content: TOOL_PROMPT },
        { role: 'assistant', content: artifact.items },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUse.id, content: TOOL_RESULT }] },
      ],
    }
  }
  if (artifact.kind === 'openai-encrypted-reasoning') {
    const item = artifact.items.find(isRecord)
    if (!item) return undefined
    return {
      user: '', maxTokens: 256, reasoningEffort: 'low', includeEncryptedReasoning: true,
      nativeMessages: [
        { role: 'user', content: MATH_PROMPT },
        { type: 'reasoning', id: item.id, summary: Array.isArray(item.summary) ? item.summary : [], encrypted_content: item.encrypted_content },
        { role: 'assistant', content: assistantText || '391' },
        { role: 'user', content: FOLLOW_UP },
      ],
    }
  }
  const call = artifact.items.filter(isRecord).find(p => isRecord(p.functionCall))
  if (!call || !isRecord(call.functionCall)) return undefined
  return {
    user: '', maxTokens: 256, thinking: { budgetTokens: 512 }, tools: [WEATHER_TOOL], toolChoice: 'auto',
    nativeMessages: [
      { role: 'user', parts: [{ text: TOOL_PROMPT }] },
      { role: 'model', parts: artifact.items },
      { role: 'user', parts: [{ functionResponse: { name: call.functionCall.name, response: { result: TOOL_RESULT } } }] },
    ],
  }
}

function skip(detail: string): ProbeOutput {
  return { evidence: [{ probe: 'signature.replay', strength: 'strong', result: 'inconclusive', category: 'substitution', detail, raw: null }], summary: detail }
}

export const signatureProbe: Probe = {
  id: 'signature',
  title: '签名回放（显式开启，需官方 key）',

  plan(ctx) {
    const kind = kindFor(ctx)
    if (!kind || ctx.mode !== 'verify') return []
    const p = elicitParams(kind, 'enabled')
    const replayOut = kind === 'anthropic-thinking' ? BUDGET + 76 : 256
    return [
      req('target', 'signature', 600, p.maxTokens),
      req('reference', 'signature', 600, p.maxTokens),
      req('reference', 'signature', 1500, replayOut),
      req('reference', 'signature', 1500, replayOut),
      req('reference', 'signature', 1500, replayOut),
    ]
  },

  async run(ctx: ProbeContext): Promise<ProbeOutput> {
    if (!ctx.reference) return skip('签名回放需要官方 reference 端点与 key。')
    const kind = kindFor(ctx)
    if (!kind) {
      return skip(`签名回放只适用于原生协议：Claude→anthropic-messages、OpenAI 推理模型→openai-responses、Gemini→google-generative-ai（当前目标 ${ctx.targetProtocol}，参考 ${ctx.referenceProtocol ?? '-'}）。`)
    }
    const mismatchStrength: Strength = kind === 'anthropic-thinking' ? 'strong' : 'medium'

    // Calibration on the official API first: if it fails, the target is never judged.
    const ref = await elicit(ctx.reference, kind, ctx)
    if (!ref.artifact) return skip(`官方参考端点没有返回 ${kind}（HTTP ${ref.result.status} ${ref.result.error?.message ?? ''}），无法校准。`)
    const refReplay = replayParams(ref.artifact, ref.result.text, ref.style)
    if (!refReplay) return skip('官方响应缺少回放所需的工具调用，无法校准。')

    const target = await elicit(ctx.target, kind, ctx)
    if (!target.result.ok) return skip(`目标请求失败：HTTP ${target.result.status} ${target.result.error?.message ?? ''}`)
    if (!target.artifact) {
      const strength: Strength = kind === 'anthropic-thinking' ? 'medium' : 'weak'
      return {
        evidence: [{ probe: 'signature.presence', strength, result: 'mismatch', category: 'substitution', detail: `请求了推理/思考，但目标没有返回 ${kind}：中转站剥离了签名，或后端不是声称的模型。`, raw: { status: target.result.status, stop: target.result.stopReason } }],
        summary: '目标未返回签名',
      }
    }
    const targetReplay = replayParams(target.artifact, target.result.text, ref.style)
    if (!targetReplay) return skip('目标响应缺少回放所需的工具调用（模型未调用工具），无法回放。')

    const positive = outcomeOf(await ctx.reference.generate('signature', refReplay, ctx.signal))
    const tampered = replayParams(withSignature(ref.artifact, mutateSignature(ref.artifact.value)), ref.result.text, ref.style) as GenerateParams
    const negative = outcomeOf(await ctx.reference.generate('signature', tampered, ctx.signal))
    let test: ReplayOutcome
    if (!positive.accepted || negative.accepted) test = { accepted: false, status: 0, message: 'not sent: calibration failed' }
    else test = outcomeOf(await ctx.reference.generate('signature', targetReplay, ctx.signal))
    const e = classifyReplay(positive, negative, test, kind, mismatchStrength)
    return { evidence: [e], summary: e.detail, data: { kind, positive, negative, test } }
  },
}
