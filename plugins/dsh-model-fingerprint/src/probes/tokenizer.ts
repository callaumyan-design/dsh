/**
 * Differential tokenizer probe (strong evidence).
 *
 * For every corpus segment two prompts are sent: the minimal prompt M and
 * M + separator + segment. Δ = input_tokens(M+S) − input_tokens(M) cancels
 * any constant framing, including an injected system prompt, so Δ depends
 * only on the tokenizer. Δ is compared to an expected Δ from the vendor's
 * own counter (Anthropic count_tokens / Gemini countTokens via the official
 * reference), local tiktoken (OpenAI), a reference measurement, or a
 * recorded baseline. The absolute minimal count, compared with the same
 * request on the official endpoint, estimates injected prompt tokens.
 */
import { roughTokens } from '../budget.ts'
import { isNativeProtocol, tiktokenEncodingFor } from '../models.ts'
import { compareDelta, CORPUS, CORPUS_VERSION, estimateChatPromptTokens, MINIMAL_PROMPT, segmentPrompt, tiktokenDelta, type DeltaComparison } from '../tokenizer.ts'
import type { Evidence, Strength } from '../types.ts'
import { median } from '../util.ts'
import { req, times, type PlanContext, type Probe, type ProbeContext, type ProbeOutput } from './types.ts'

type ExpectedSource = 'count_tokens' | 'countTokens' | 'tiktoken' | 'reference' | 'baseline'

function usesOfficialCounter(ctx: PlanContext): 'count_tokens' | 'countTokens' | undefined {
  if (!ctx.hasReference) return undefined
  if (ctx.vendor === 'anthropic' && ctx.referenceProtocol === 'anthropic-messages') return 'count_tokens'
  if (ctx.vendor === 'google' && ctx.referenceProtocol === 'google-generative-ai') return 'countTokens'
  return undefined
}

function baselineUsable(ctx: PlanContext): boolean {
  return ctx.baseline?.tokenizer !== undefined && ctx.baseline.corpusVersion === CORPUS_VERSION
}

const maxTok = 1

export const tokenizerProbe: Probe = {
  id: 'tokenizer',
  title: '差分分词器',

  plan(ctx) {
    const plan = [
      ...times(ctx.samples, () => req('target', 'tokenizer', roughTokens(MINIMAL_PROMPT), 16)),
      ...CORPUS.map(s => req('target', 'tokenizer', roughTokens(segmentPrompt(s)), 16)),
    ]
    if (ctx.mode === 'record') return plan
    const counter = usesOfficialCounter(ctx)
    if (counter) plan.push(...times(CORPUS.length + 1, () => req('reference', 'tokenizer', 0, 0, true)))
    else if (ctx.hasReference && ctx.vendor !== 'openai' && !baselineUsable(ctx)) {
      plan.push(req('reference', 'tokenizer', roughTokens(MINIMAL_PROMPT), 16))
      plan.push(...CORPUS.map(s => req('reference', 'tokenizer', roughTokens(segmentPrompt(s)), 16)))
    }
    // Same minimal request on the official endpoint for the injection estimate.
    if (ctx.hasReference) plan.push(req('reference', 'tokenizer', roughTokens(MINIMAL_PROMPT), 16))
    return plan
  },

  async run(ctx: ProbeContext): Promise<ProbeOutput> {
    const evidence: Evidence[] = []
    const minimal: number[] = []
    for (let i = 0; i < ctx.samples; i++) {
      const r = await ctx.target.generate('tokenizer', { user: MINIMAL_PROMPT, maxTokens: maxTok }, ctx.signal)
      if (!r.ok) return failure(`最小请求失败：HTTP ${r.status} ${r.error?.message ?? ''}`, r)
      if (r.usage.inputTokens === undefined) return failure('目标端点没有返回输入 token 用量（usage），无法做差分分词。', r)
      minimal.push(r.usage.inputTokens)
    }
    const minimalMedian = median(minimal) as number
    const observed: Record<string, number> = {}
    for (const seg of CORPUS) {
      const r = await ctx.target.generate('tokenizer', { user: segmentPrompt(seg), maxTokens: maxTok }, ctx.signal)
      if (r.ok && r.usage.inputTokens !== undefined) observed[seg.id] = r.usage.inputTokens - minimalMedian
    }

    if (ctx.mode === 'record') {
      ctx.record.tokenizer = { minimalInputTokens: minimal, deltas: observed }
      return { evidence: [], summary: `已记录最小请求 ${minimal.join('/')} tokens 与 ${Object.keys(observed).length} 段语料的 Δ`, data: { minimal, deltas: observed } }
    }

    if (Math.max(...minimal) - Math.min(...minimal) > 2) {
      evidence.push({
        probe: 'tokenizer.stability', strength: 'weak', result: 'inconclusive', category: 'substitution',
        detail: `同一最小请求的 input_tokens 在 ${ctx.samples} 次采样间不一致（${minimal.join(', ')}），可能是混合路由或 usage 被改写。`,
        raw: { minimal },
      })
    }

    // Expected deltas.
    let expected: Record<string, number> = {}
    let source: ExpectedSource | undefined
    const counter = usesOfficialCounter(ctx)
    const notes: string[] = []
    if (ctx.vendor === 'openai') {
      const enc = tiktokenEncodingFor(ctx.claimedModel)
      for (const seg of CORPUS) expected[seg.id] = await tiktokenDelta(enc, seg)
      source = 'tiktoken'
      notes.push(`期望值来自本地 tiktoken ${enc}`)
    } else if (counter && ctx.reference) {
      const base = await ctx.reference.countTokens('tokenizer', { user: MINIMAL_PROMPT }, ctx.signal)
      if (base.tokens !== undefined) {
        for (const seg of CORPUS) {
          const c = await ctx.reference.countTokens('tokenizer', { user: segmentPrompt(seg) }, ctx.signal)
          if (c.tokens !== undefined) expected[seg.id] = c.tokens - base.tokens
        }
        source = counter
        notes.push(`期望值来自官方 ${counter}`)
      } else {
        notes.push(`官方 ${counter} 调用失败（${base.error ?? base.status}），改用基线或参考端点实测`)
      }
    }
    if (source === undefined && baselineUsable(ctx)) {
      expected = { ...ctx.baseline!.tokenizer!.deltas }
      source = 'baseline'
      notes.push(`期望值来自基线 ${ctx.baseline!.id}（${ctx.baseline!.recordedAt}）`)
    }
    if (source === undefined && ctx.reference) {
      const base = await ctx.reference.generate('tokenizer', { user: MINIMAL_PROMPT, maxTokens: maxTok }, ctx.signal)
      if (base.ok && base.usage.inputTokens !== undefined) {
        for (const seg of CORPUS) {
          const r = await ctx.reference.generate('tokenizer', { user: segmentPrompt(seg), maxTokens: maxTok }, ctx.signal)
          if (r.ok && r.usage.inputTokens !== undefined) expected[seg.id] = r.usage.inputTokens - base.usage.inputTokens
        }
        source = 'reference'
        notes.push('期望值来自官方参考端点实测')
      }
    }

    let comparisons: DeltaComparison[] = []
    if (source === undefined) {
      evidence.push({
        probe: 'tokenizer.delta', strength: 'strong', result: 'inconclusive', category: 'substitution',
        detail: `没有期望值来源：${ctx.vendor === 'anthropic' ? 'Anthropic 需要官方 reference（count_tokens）' : ctx.vendor === 'google' ? 'Gemini 需要官方 reference（countTokens）' : '该厂商需要 reference 实测'}或已录制的基线。`,
        raw: { observed },
      })
    } else {
      comparisons = CORPUS.filter(s => observed[s.id] !== undefined && expected[s.id] !== undefined)
        .map(s => compareDelta(s.id, observed[s.id] as number, expected[s.id] as number))
      evidence.push(deltaEvidence(comparisons, source, notes))
    }

    // Injection estimate from the absolute minimal count.
    evidence.push(await injectionEvidence(ctx, minimalMedian))

    const summary = source === undefined
      ? `最小请求 ${minimalMedian} tokens；缺少期望值来源`
      : `${comparisons.filter(c => c.verdict === 'match').length}/${comparisons.length} 段 Δ 与期望一致（来源：${source}）`
    return { evidence, summary, data: { minimal, observed, expected, source, comparisons } }
  },
}

function failure(detail: string, r: unknown): ProbeOutput {
  return {
    evidence: [{ probe: 'tokenizer.delta', strength: 'strong', result: 'inconclusive', category: 'substitution', detail, raw: summarizeResult(r) }],
    summary: detail,
  }
}

function summarizeResult(r: unknown): unknown {
  if (r === null || typeof r !== 'object') return r
  const { status, error, usage, headers } = r as Record<string, unknown>
  return { status, error, usage, headers }
}

/** Aggregate per-segment comparisons into one strong/medium piece of evidence. */
export function deltaEvidence(comparisons: DeltaComparison[], source: string, notes: string[] = []): Evidence {
  const n = comparisons.length
  const matches = comparisons.filter(c => c.verdict === 'match').length
  const mismatches = comparisons.filter(c => c.verdict === 'mismatch')
  const table = comparisons.map(c => `${c.segment}: 实测 ${c.observed} / 期望 ${c.expected}`).join('；')
  const base = { probe: 'tokenizer.delta', category: 'substitution' as const, raw: { source, comparisons, notes } }
  if (n < 4) return { ...base, strength: 'strong', result: 'inconclusive', detail: `可比较的语料段太少（${n}），${table}` }
  // Token counts are deterministic: a genuine tokenizer leaves no segment far off,
  // so 40% of segments beyond tolerance is already decisive.
  const mismatchRate = mismatches.length / n
  if (mismatchRate >= 0.4) {
    return { ...base, strength: 'strong', result: 'mismatch', detail: `${mismatches.length}/${n} 段语料的 token 差值与期望明显不符，分词器与声称模型不同。${table}` }
  }
  if (mismatchRate >= 0.2) {
    return { ...base, strength: 'medium', result: 'mismatch', detail: `${mismatches.length}/${n} 段语料 Δ 不符（部分一致，可能是混合路由或同族不同版本）。${table}` }
  }
  if (matches / n >= 0.8 && mismatches.length === 0) {
    return { ...base, strength: 'strong', result: 'match', detail: `${matches}/${n} 段语料的 token 差值与期望一致（来源：${source}）。` }
  }
  return { ...base, strength: 'strong', result: 'inconclusive', detail: `Δ 接近但不完全一致（${matches}/${n} 精确一致）。${table}` }
}

async function injectionEvidence(ctx: ProbeContext, minimalTarget: number): Promise<Evidence> {
  let expected: number | undefined
  let strength: Strength = 'weak'
  let via = ''
  let tolerance = 5
  if (ctx.reference) {
    const r = await ctx.reference.generate('tokenizer', { user: MINIMAL_PROMPT, maxTokens: maxTok }, ctx.signal)
    if (r.ok && r.usage.inputTokens !== undefined) {
      expected = r.usage.inputTokens
      const sameProtocol = ctx.reference.info.protocol === ctx.target.info.protocol
      strength = sameProtocol ? 'strong' : 'medium'
      tolerance = sameProtocol ? Math.max(5, 0.05 * expected) : Math.max(12, 0.15 * expected)
      via = sameProtocol ? '官方参考端点同一请求' : '官方参考端点（协议不同，容差放宽）'
    }
  }
  if (expected === undefined && ctx.baseline?.tokenizer?.minimalInputTokens.length) {
    expected = median(ctx.baseline.tokenizer.minimalInputTokens)
    strength = 'medium'
    const sameProtocol = ctx.baseline.protocol === ctx.target.info.protocol
    tolerance = sameProtocol ? Math.max(5, 0.05 * (expected ?? 0)) : Math.max(12, 0.15 * (expected ?? 0))
    via = `基线 ${ctx.baseline.id}`
  }
  if (expected === undefined && ctx.vendor === 'openai' && ctx.target.info.protocol === 'openai-completions' && isNativeProtocol(ctx.vendor, ctx.target.info.protocol)) {
    expected = await estimateChatPromptTokens(tiktokenEncodingFor(ctx.claimedModel), MINIMAL_PROMPT)
    strength = 'weak'
    tolerance = 6
    via = 'tiktoken + Chat 模板估算'
  }
  const raw = { minimalTarget, expected, via, tolerance }
  if (expected === undefined) {
    return { probe: 'tokenizer.injection', strength: 'weak', result: 'inconclusive', category: 'injection', detail: `最小请求 input_tokens = ${minimalTarget}；没有参考端点或基线，无法估算注入量。`, raw }
  }
  const injected = Math.round(minimalTarget - expected)
  if (injected > tolerance) {
    return { probe: 'tokenizer.injection', strength, result: 'mismatch', category: 'injection', detail: `疑似注入 system prompt：最小请求多出约 ${injected} tokens（目标 ${minimalTarget}，期望 ${expected}，来源：${via}）。`, raw: { ...raw, injected } }
  }
  if (injected < -tolerance) {
    return { probe: 'tokenizer.injection', strength: 'weak', result: 'inconclusive', category: 'injection', detail: `目标最小请求比期望少 ${-injected} tokens（目标 ${minimalTarget}，期望 ${expected}），可能是 usage 被改写或分词器不同。`, raw: { ...raw, injected } }
  }
  // Absence of injection says nothing about model identity: never stronger than medium.
  return { probe: 'tokenizer.injection', strength: strength === 'strong' ? 'medium' : strength, result: 'match', category: 'injection', detail: `未发现注入：最小请求 ${minimalTarget} tokens，期望 ${expected}（来源：${via}，容差 ±${Math.round(tolerance)}）。`, raw: { ...raw, injected } }
}
