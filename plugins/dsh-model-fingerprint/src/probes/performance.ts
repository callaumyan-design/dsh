/**
 * Performance probe (weak evidence): time to first token and decode speed
 * over `samples` streamed generations; medians and quartiles compared with
 * the reference or baseline. Relay overhead inflates TTFT, so only decode
 * speed (tokens/s) is used for a match/mismatch call, and only weakly.
 */
import { isOpenAIReasoningModel } from '../models.ts'
import type { Evidence, GenerationResult } from '../types.ts'
import { median, round, summarize, type Summary } from '../util.ts'
import { req, times, type Probe, type ProbeContext, type ProbeOutput } from './types.ts'

const PROMPT = 'Count from 1 to 60, separated by commas. Output only the numbers.'
const MAX_TOKENS = 160

export function speedOf(r: GenerationResult): { ttftMs?: number; tokensPerSecond?: number } {
  const s = r.stream
  if (!r.ok || !s) return {}
  const out = r.usage.outputTokens
  const genMs = s.generationMs !== undefined && s.generationMs > 0 ? s.generationMs : s.ttftMs !== undefined ? s.totalMs - s.ttftMs : undefined
  return {
    ttftMs: s.ttftMs !== undefined ? Math.round(s.ttftMs) : undefined,
    tokensPerSecond: out !== undefined && out > 1 && genMs !== undefined && genMs > 0 ? round((out - 1) / (genMs / 1000), 1) : undefined,
  }
}

export function compareSpeed(target: number[], expected: number[], label: string): Evidence {
  const t = median(target)
  const e = median(expected)
  const raw = { target: summarize(target), expected: summarize(expected) }
  if (t === undefined || e === undefined || e <= 0) return { probe: 'performance.speed', strength: 'weak', result: 'inconclusive', category: 'substitution', detail: '缺少可比较的速度样本。', raw }
  const ratio = t / e
  if (ratio >= 0.4 && ratio <= 2.5) return { probe: 'performance.speed', strength: 'weak', result: 'match', category: 'substitution', detail: `解码速度中位数 ${t.toFixed(1)} tok/s，与${label} ${e.toFixed(1)} tok/s 处于同一量级（比值 ${ratio.toFixed(2)}）。`, raw }
  return { probe: 'performance.speed', strength: 'weak', result: 'mismatch', category: 'substitution', detail: `解码速度中位数 ${t.toFixed(1)} tok/s，与${label} ${e.toFixed(1)} tok/s 差异显著（比值 ${ratio.toFixed(2)}）。速度受负载影响大，仅作弱证据。`, raw }
}

async function measure(ctx: ProbeContext, which: 'target' | 'reference'): Promise<{ ttft: number[]; tps: number[] }> {
  const ep = which === 'target' ? ctx.target : ctx.reference!
  const ttft: number[] = []
  const tps: number[] = []
  for (let i = 0; i < ctx.samples; i++) {
    const reasoning = ctx.vendor === 'openai' && isOpenAIReasoningModel(ctx.claimedModel)
    const r = await ep.generate('performance', reasoning
      ? { user: PROMPT, maxTokens: MAX_TOKENS + 256, reasoningEffort: 'low', stream: true }
      : { user: PROMPT, maxTokens: MAX_TOKENS, temperature: 0, stream: true }, ctx.signal)
    const s = speedOf(r)
    if (s.ttftMs !== undefined) ttft.push(s.ttftMs)
    if (s.tokensPerSecond !== undefined) tps.push(s.tokensPerSecond)
  }
  return { ttft, tps }
}

function fmt(s: Summary, unit: string): string {
  return s.n === 0 ? '无样本' : `中位数 ${s.median}${unit}（Q1 ${s.q1} / Q3 ${s.q3}，n=${s.n}）`
}

export const performanceProbe: Probe = {
  id: 'performance',
  title: '性能',

  plan(ctx) {
    const cap = ctx.vendor === 'openai' && isOpenAIReasoningModel(ctx.claimedModel) ? MAX_TOKENS + 256 : MAX_TOKENS
    const plan = times(ctx.samples, () => req('target', 'performance', 30, cap))
    if (ctx.mode === 'verify' && ctx.hasReference) plan.push(...times(ctx.samples, () => req('reference', 'performance', 30, cap)))
    return plan
  },

  async run(ctx: ProbeContext): Promise<ProbeOutput> {
    const target = await measure(ctx, 'target')
    const data: Record<string, unknown> = { target: { ttftMs: summarize(target.ttft), tokensPerSecond: summarize(target.tps) } }
    if (ctx.mode === 'record') {
      ctx.record.performance = { ttftMs: target.ttft, tokensPerSecond: target.tps }
      return { evidence: [], summary: `TTFT ${fmt(summarize(target.ttft), ' ms')}；速度 ${fmt(summarize(target.tps), ' tok/s')}`, data }
    }
    let expected: number[] | undefined
    let label = ''
    if (ctx.reference) {
      const ref = await measure(ctx, 'reference')
      expected = ref.tps
      label = '官方参考端点'
      data.reference = { ttftMs: summarize(ref.ttft), tokensPerSecond: summarize(ref.tps) }
    } else if (ctx.baseline?.performance) {
      expected = ctx.baseline.performance.tokensPerSecond
      label = `基线 ${ctx.baseline.id}`
    }
    const evidence: Evidence[] = expected
      ? [compareSpeed(target.tps, expected, label)]
      : [{ probe: 'performance.speed', strength: 'weak', result: 'inconclusive', category: 'substitution', detail: `TTFT ${fmt(summarize(target.ttft), ' ms')}，速度 ${fmt(summarize(target.tps), ' tok/s')}；没有参考可比较。`, raw: data }]
    return { evidence, summary: `TTFT ${fmt(summarize(target.ttft), ' ms')}；速度 ${fmt(summarize(target.tps), ' tok/s')}`, data }
  },
}
