/**
 * Context-window check (opt-in, expensive; medium evidence). Sends one
 * prompt of roughly `contextTokens` tokens (default 75% of the advertised
 * window) with a 1-token output cap. A substitute with a smaller window
 * fails with a context-length error; the genuine model accepts it.
 */
import { knownContextWindow } from '../models.ts'
import { countTiktoken } from '../tokenizer.ts'
import type { Evidence } from '../types.ts'
import { req, type PlanContext, type Probe, type ProbeContext, type ProbeOutput } from './types.ts'

const UNIT = 'The archive holds record number 12345 of the series, filed under section seven. '

export function contextTarget(ctx: Pick<PlanContext, 'claimedModel' | 'contextTokens'>): number | undefined {
  if (ctx.contextTokens !== undefined && ctx.contextTokens > 0) return Math.floor(ctx.contextTokens)
  const window = knownContextWindow(ctx.claimedModel)
  return window === undefined ? undefined : Math.floor(window * 0.75)
}

export const contextProbe: Probe = {
  id: 'context_limit',
  title: '上下文上限（显式开启）',

  plan(ctx) {
    const n = contextTarget(ctx)
    return n === undefined ? [] : [req('target', 'context_limit', n + 50, 16)]
  },

  async run(ctx: ProbeContext): Promise<ProbeOutput> {
    const n = contextTarget(ctx)
    if (n === undefined) {
      return { evidence: [{ probe: 'context_limit', strength: 'medium', result: 'inconclusive', category: 'substitution', detail: `不知道 ${ctx.claimedModel} 的上下文窗口；请传 contextTokens。`, raw: null }], summary: '跳过：窗口未知' }
    }
    const perUnit = await countTiktoken('o200k_base', UNIT)
    const repeat = Math.max(1, Math.floor(n / perUnit))
    const prompt = `${UNIT.repeat(repeat)}\nReply with OK.`
    const r = await ctx.target.generate('context_limit', { user: prompt, maxTokens: 1 }, ctx.signal)
    const raw = { requestedTokensApprox: n, status: r.status, inputTokens: r.usage.inputTokens, error: r.error }
    let e: Evidence
    if (r.ok) {
      const seen = r.usage.inputTokens
      e = seen !== undefined && seen < n * 0.6
        ? { probe: 'context_limit', strength: 'weak', result: 'inconclusive', category: 'substitution', detail: `请求被接受，但只计了 ${seen} 个输入 token（约 ${n}），提示可能被截断。`, raw }
        : { probe: 'context_limit', strength: 'medium', result: 'match', category: 'substitution', detail: `约 ${n} tokens 的长提示被接受${seen !== undefined ? `（计 ${seen} tokens）` : ''}。`, raw }
    } else if (/context|too long|maximum|token limit|exceed|length/i.test(`${r.error?.message ?? ''} ${r.error?.code ?? ''}`)) {
      e = { probe: 'context_limit', strength: 'medium', result: 'mismatch', category: 'substitution', detail: `约 ${n} tokens 的提示被以上下文长度为由拒绝，后端窗口小于 ${ctx.claimedModel} 的公开值：${r.error?.message ?? ''}`, raw }
    } else {
      e = { probe: 'context_limit', strength: 'medium', result: 'inconclusive', category: 'substitution', detail: `长提示请求失败（HTTP ${r.status}）：${r.error?.message ?? ''}`, raw }
    }
    return { evidence: [e], summary: e.detail }
  },
}
