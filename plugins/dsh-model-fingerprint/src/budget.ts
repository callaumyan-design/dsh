/** Request/token/cost budget: estimate before running, enforce while running. */
import { priceFor } from './models.ts'
import type { BudgetLimits } from './types.ts'

/** Conservative defaults: a full default run against a mid-priced model fits; expensive probes do not. */
export const DEFAULT_BUDGET: BudgetLimits = {
  maxRequests: 120,
  maxInputTokens: 60_000,
  maxOutputTokens: 12_000,
  maxCostUsd: 0.5,
}

/** One request a probe intends to send. */
export interface PlannedRequest {
  endpoint: 'target' | 'reference'
  probe: string
  /** Estimated prompt tokens (upper bound). */
  inputTokens: number
  /** Output cap actually sent (upper bound of billed output). */
  outputTokens: number
  /** count_tokens / countTokens style calls are free of token charges but still count as requests. */
  free?: boolean
}

export interface BudgetEstimate {
  requests: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  byProbe: Record<string, { requests: number; inputTokens: number; outputTokens: number; costUsd: number }>
  priceNotes: string[]
}

export interface ModelPricing { target: string; reference?: string }

export class BudgetExceededError extends Error {
  constructor(message: string) { super(message); this.name = 'BudgetExceededError' }
}

function costOf(model: string, input: number, output: number, limits: BudgetLimits): number {
  const p = priceFor(model)
  const inPrice = limits.inputPricePerMTok ?? p.input
  const outPrice = limits.outputPricePerMTok ?? p.output
  return (input * inPrice + output * outPrice) / 1_000_000
}

export function estimate(plan: readonly PlannedRequest[], models: ModelPricing, limits: BudgetLimits): BudgetEstimate {
  const est: BudgetEstimate = { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, byProbe: {}, priceNotes: [] }
  for (const req of plan) {
    const model = req.endpoint === 'reference' ? (models.reference ?? models.target) : models.target
    const input = req.free ? 0 : req.inputTokens
    const output = req.free ? 0 : req.outputTokens
    const cost = costOf(model, input, output, limits)
    est.requests++
    est.inputTokens += input
    est.outputTokens += output
    est.costUsd += cost
    const slot = est.byProbe[req.probe] ??= { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }
    slot.requests++
    slot.inputTokens += input
    slot.outputTokens += output
    slot.costUsd += cost
  }
  for (const model of new Set([models.target, models.reference].filter((m): m is string => m !== undefined))) {
    const p = priceFor(model)
    if (limits.inputPricePerMTok !== undefined || limits.outputPricePerMTok !== undefined) continue
    est.priceNotes.push(p.known
      ? `${model}: 按约 $${p.input}/$${p.output} 每百万输入/输出 token 估算（公开价目近似值）`
      : `${model}: 未知价格，按保守的 $${p.input}/$${p.output} 每百万 token 估算`)
  }
  return est
}

/** Returns the first limit the estimate breaks, or undefined. */
export function exceeds(est: BudgetEstimate, limits: BudgetLimits): string | undefined {
  if (est.requests > limits.maxRequests) return `预计请求数 ${est.requests} 超过上限 ${limits.maxRequests}`
  if (est.inputTokens > limits.maxInputTokens) return `预计输入 token ${est.inputTokens} 超过上限 ${limits.maxInputTokens}`
  if (est.outputTokens > limits.maxOutputTokens) return `预计输出 token 上限合计 ${est.outputTokens} 超过上限 ${limits.maxOutputTokens}`
  if (est.costUsd > limits.maxCostUsd) return `预计费用 $${est.costUsd.toFixed(4)} 超过上限 $${limits.maxCostUsd}`
  return undefined
}

/** Live accounting of what was actually sent and billed. */
export class BudgetTracker {
  requests = 0
  inputTokens = 0
  outputTokens = 0
  costUsd = 0

  constructor(readonly limits: BudgetLimits, private readonly models: ModelPricing) {}

  /** Throw before sending when the next request could break a limit. */
  reserve(endpoint: 'target' | 'reference', inputTokens: number, outputTokens: number, free = false): void {
    if (this.requests + 1 > this.limits.maxRequests) throw new BudgetExceededError(`请求数已达上限 ${this.limits.maxRequests}`)
    if (free) return
    if (this.inputTokens + inputTokens > this.limits.maxInputTokens) throw new BudgetExceededError(`输入 token 将超过上限 ${this.limits.maxInputTokens}`)
    if (this.outputTokens + outputTokens > this.limits.maxOutputTokens) throw new BudgetExceededError(`输出 token 将超过上限 ${this.limits.maxOutputTokens}`)
    const model = endpoint === 'reference' ? (this.models.reference ?? this.models.target) : this.models.target
    if (this.costUsd + costOf(model, inputTokens, outputTokens, this.limits) > this.limits.maxCostUsd) {
      throw new BudgetExceededError(`费用将超过上限 $${this.limits.maxCostUsd}`)
    }
  }

  /** Record one sent request; usage numbers are the billed ones when the endpoint reported them. */
  record(endpoint: 'target' | 'reference', inputTokens: number, outputTokens: number, free = false): void {
    this.requests++
    if (free) return
    this.inputTokens += inputTokens
    this.outputTokens += outputTokens
    const model = endpoint === 'reference' ? (this.models.reference ?? this.models.target) : this.models.target
    this.costUsd += costOf(model, inputTokens, outputTokens, this.limits)
  }

  snapshot(): { requests: number; inputTokens: number; outputTokens: number; costUsd: number } {
    return { requests: this.requests, inputTokens: this.inputTokens, outputTokens: this.outputTokens, costUsd: Math.round(this.costUsd * 1e6) / 1e6 }
  }
}

/** Rough token count for budgeting only (never used as evidence): ~4 chars/token for ASCII, 1 per CJK/emoji char. */
export function roughTokens(text: string): number {
  let ascii = 0
  let wide = 0
  for (const ch of text) {
    if (ch.charCodeAt(0) < 128) ascii++
    else wide++
  }
  return Math.ceil(ascii / 3.5) + wide * 2 + 8
}
