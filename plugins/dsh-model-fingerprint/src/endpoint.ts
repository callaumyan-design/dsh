/** One resolved endpoint: protocol adapter + origin-bound transport + budget metering. */
import { BudgetTracker, roughTokens } from './budget.ts'
import { OriginTransport, type TransportOptions } from './http.ts'
import { adapterFor, type GenerateParams, type ProtocolAdapter } from './protocols/index.ts'
import type { AdapterOptions } from './protocols/common.ts'
import { anthropicRoot } from './protocols/anthropic.ts'
import type { Redactor } from './redact.ts'
import type { EndpointInfo, GenerationResult } from './types.ts'

export interface EndpointSpec {
  info: EndpointInfo
  /** Secret value; kept inside the transport closure only. */
  secret: string
  headers: Record<string, string>
  adapterOptions: AdapterOptions
}

export interface CallLogEntry {
  endpoint: 'target' | 'reference'
  probe: string
  status: number
  latencyMs: number
  attempts: number
  inputTokens?: number
  outputTokens?: number
  error?: string
}

export class Endpoint {
  readonly adapter: ProtocolAdapter
  private readonly transport: OriginTransport
  readonly calls: CallLogEntry[] = []

  constructor(
    readonly info: EndpointInfo,
    secret: string,
    headers: Record<string, string>,
    readonly adapterOptions: AdapterOptions,
    transportOptions: TransportOptions,
    private readonly budget: BudgetTracker,
    private readonly redactor: Redactor,
    fetchImpl?: typeof fetch,
  ) {
    this.adapter = adapterFor(info.protocol)
    const base = info.protocol === 'anthropic-messages' ? anthropicRoot(info.baseURL) : info.baseURL.replace(/\/+$/, '')
    this.transport = new OriginTransport(info.origin, base, info.protocol, secret, headers, transportOptions, fetchImpl)
  }

  get role(): 'target' | 'reference' { return this.info.role }
  get model(): string { return this.info.model }
  get rateLimited(): number { return this.transport.rateLimited }

  /** Send one generation request; budget is reserved from the estimate and charged from reported usage. */
  async generate(probe: string, params: GenerateParams, signal?: AbortSignal): Promise<GenerationResult> {
    const p: GenerateParams = { ...params, maxTokens: Math.max(this.adapter.minMaxTokens, params.maxTokens) }
    const estIn = roughTokens(`${p.system ?? ''}${p.user}${p.nativeMessages ? JSON.stringify(p.nativeMessages) : ''}`)
    const body = this.adapter.buildBody(this.info.model, p, this.adapterOptions)
    const raw = await this.transport.send(this.adapter.generatePath(this.info.model, p.stream === true), body, {
      stream: p.stream === true,
      signal,
      meter: {
        beforeAttempt: (attempt) => {
          // A retry is a real request: charge the previous (failed) attempt before reserving the next one.
          if (attempt > 0) this.budget.record(this.role, 0, 0)
          this.budget.reserve(this.role, estIn, p.maxTokens)
        },
      },
    })
    const result = this.adapter.parse(raw)
    // Tokens from usage when reported, else the estimate for a delivered response.
    const charged = result.ok
      ? { input: result.usage.inputTokens ?? estIn, output: result.usage.outputTokens ?? p.maxTokens }
      : { input: raw.status >= 400 && raw.status < 500 ? 0 : estIn, output: 0 }
    this.budget.record(this.role, charged.input, charged.output)
    this.calls.push({
      endpoint: this.role, probe, status: raw.status, latencyMs: Math.round(raw.latencyMs), attempts: raw.attempts,
      inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens,
      ...result.error ? { error: this.redactor.redactString(result.error.message ?? result.error.type ?? 'error') } : {},
    })
    if (result.error?.message) result.error.message = this.redactor.redactString(result.error.message)
    result.body = this.redactor.redact(result.body)
    return result
  }

  /** Official token counting (Anthropic count_tokens / Gemini countTokens); undefined when unsupported or failed. */
  async countTokens(probe: string, input: Pick<GenerateParams, 'user' | 'system' | 'nativeMessages'>, signal?: AbortSignal): Promise<{ tokens?: number; status: number; error?: string }> {
    const a = this.adapter
    const params: GenerateParams = { ...input, maxTokens: 1 }
    if (!a.countTokensPath || !a.countTokensBody || !a.parseCountTokens) return { status: 0, error: 'count tokens not supported by protocol' }
    const raw = await this.transport.send(a.countTokensPath(this.info.model), a.countTokensBody(this.info.model, params), {
      signal,
      meter: {
        beforeAttempt: (attempt) => {
          if (attempt > 0) this.budget.record(this.role, 0, 0, true)
          this.budget.reserve(this.role, 0, 0, true)
        },
      },
    })
    this.budget.record(this.role, 0, 0, true)
    const tokens = raw.ok ? a.parseCountTokens(raw.json) : undefined
    const error = raw.ok ? undefined : this.redactor.redactString(raw.transportError ?? raw.text?.slice(0, 300) ?? `HTTP ${raw.status}`)
    this.calls.push({ endpoint: this.role, probe: `${probe}:count_tokens`, status: raw.status, latencyMs: Math.round(raw.latencyMs), attempts: raw.attempts, ...error ? { error } : {} })
    return { tokens, status: raw.status, ...error ? { error } : {} }
  }
}
