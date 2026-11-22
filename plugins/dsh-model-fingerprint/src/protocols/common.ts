/** Protocol-neutral request description and adapter contract. */
import type { RawResponse } from '../http.ts'
import type { GenerationResult, Protocol } from '../types.ts'
import { describeFormat, isRecord, asString } from '../util.ts'

export interface ToolSpec {
  name: string
  description: string
  /** JSON Schema of the arguments object. */
  parameters: Record<string, unknown>
}

export interface GenerateParams {
  system?: string
  user: string
  maxTokens: number
  temperature?: number
  stop?: string[]
  tools?: ToolSpec[]
  /** Force one named tool, or let the model decide. */
  toolChoice?: { name: string } | 'auto'
  /** Request token logprobs with this many alternatives (OpenAI Chat only). */
  topLogprobs?: number
  stream?: boolean
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
  /** Enable extended thinking (Anthropic budget / Gemini thoughts / OpenAI reasoning). */
  thinking?: { budgetTokens: number; style?: 'enabled' | 'adaptive' }
  /** OpenAI Responses: ask for `reasoning.encrypted_content` (store=false). */
  includeEncryptedReasoning?: boolean
  /** Protocol-native fields merged last into the body (used by replay requests). */
  extra?: Record<string, unknown>
  /** Override the default message list (protocol-native shape) — used by signature replay. */
  nativeMessages?: unknown[]
}

export interface AdapterOptions {
  /** OpenAI Chat output-cap field. */
  maxTokensField?: 'max_tokens' | 'max_completion_tokens'
}

export interface ProtocolAdapter {
  readonly protocol: Protocol
  /** Relative API path for a generation. */
  generatePath(model: string, stream: boolean): string
  buildBody(model: string, params: GenerateParams, options: AdapterOptions): Record<string, unknown>
  parse(raw: RawResponse): GenerationResult
  /** Minimum output cap the protocol accepts (Responses requires >= 16). */
  readonly minMaxTokens: number
  countTokensPath?(model: string): string
  countTokensBody?(model: string, params: GenerateParams): Record<string, unknown>
  parseCountTokens?(json: unknown): number | undefined
}

/** Extract a provider error from any of the four protocols' error envelopes. */
export function extractError(json: unknown, fallbackText?: string): { type?: string; code?: string; message?: string } | undefined {
  if (isRecord(json)) {
    const err = json.error
    if (isRecord(err)) {
      return {
        type: asString(err.type) ?? asString(err.status),
        code: asString(err.code) ?? (typeof err.code === 'number' ? String(err.code) : undefined),
        message: asString(err.message),
      }
    }
    if (typeof err === 'string') return { message: err }
    if (asString(json.message)) return { message: asString(json.message), type: asString(json.type) }
  }
  if (fallbackText) return { message: fallbackText.slice(0, 500) }
  return undefined
}

const SKIP_HEADERS = /^(set-cookie|cookie|authorization|x-api-key|content-length|date|connection|keep-alive|transfer-encoding|alt-svc|strict-transport-security)$/i
const KNOWN_SERVERS = ['cloudflare', 'nginx', 'openresty', 'envoy', 'uvicorn', 'gunicorn', 'google frontend', 'esf', 'scaffolding on httpserver2', 'caddy', 'apache', 'awselb', 'kestrel', 'istio', 'vercel', 'deno', 'bun', 'node']

/** Header map → name: format descriptor. Values are never kept, except a fixed vocabulary for server/via. */
export function describeHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((value, name) => {
    if (SKIP_HEADERS.test(name)) return
    if (name === 'server' || name === 'via') {
      const lower = value.toLowerCase()
      const known = KNOWN_SERVERS.find(s => lower.includes(s))
      out[name] = known ? `known:${known}` : describeFormat(value)
      return
    }
    if (name === 'content-type') { out[name] = value.split(';')[0]?.trim() ?? ''; return }
    out[name] = describeFormat(value)
  })
  return out
}

export function emptyResult(raw: RawResponse): GenerationResult {
  return {
    ok: raw.ok,
    status: raw.status,
    headers: describeHeaders(raw.headers),
    latencyMs: raw.latencyMs,
    text: '',
    stop: 'unknown',
    usage: {},
    toolCalls: [],
    signatures: [],
    body: raw.json ?? raw.text,
  }
}

/** Common failure parsing; returns a finished result when the response is not a success. */
export function failureResult(raw: RawResponse): GenerationResult | undefined {
  if (raw.ok) return undefined
  const result = emptyResult(raw)
  result.error = raw.transportError
    ? { type: 'transport', message: raw.transportError }
    : extractError(raw.json, raw.text) ?? { message: `HTTP ${raw.status}` }
  return result
}

export function parseJsonData(data: string): unknown {
  try { return JSON.parse(data) } catch { return undefined }
}
