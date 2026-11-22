/**
 * Raw HTTP transport bound to one endpoint origin. The secret lives only in
 * this object's closure and is attached only to requests whose URL resolves
 * to the bound origin; redirects are never followed (a redirect could carry a
 * custom key header to another host).
 */
import { readSse, type SseEvent } from './sse.ts'
import { AbortedError, sleep } from './util.ts'
import type { Protocol } from './types.ts'

export interface TransportOptions {
  timeoutMs: number
  maxRetries: number
  minIntervalMs: number
  maxBackoffMs: number
  /** Upper bound of the paced interval after repeated 429s. */
  maxIntervalMs: number
}

export interface RawResponse {
  ok: boolean
  status: number
  headers: Headers
  json?: unknown
  text?: string
  events?: SseEvent[]
  latencyMs: number
  attempts: number
  /** Transport-level failure (timeout, network, redirect, budget) when no HTTP status exists. */
  transportError?: string
}

/** Hooks the caller uses to meter each attempt (retries are real requests too). */
export interface AttemptMeter {
  /** Called before every attempt; throw to stop (e.g. budget exhausted). */
  beforeAttempt(attempt: number): void
}

export class OriginMismatchError extends Error {
  constructor(message: string) { super(message); this.name = 'OriginMismatchError' }
}

/** Join a base URL and a relative API path without losing the base path. */
export function joinURL(baseURL: string, path: string): string {
  const base = baseURL.replace(/\/+$/, '')
  const rel = path.replace(/^\/+/, '')
  return rel === '' ? base : `${base}/${rel}`
}

/** Parse a Retry-After header (seconds or HTTP date) into milliseconds. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (value === null || value.trim() === '') return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const date = Date.parse(value)
  if (Number.isFinite(date)) return Math.max(0, date - now)
  return undefined
}

/** Exponential backoff with full jitter. */
export function backoffMs(attempt: number, maxBackoffMs: number, random = Math.random): number {
  const cap = Math.min(maxBackoffMs, 1000 * 2 ** attempt)
  return Math.round(cap / 2 + random() * (cap / 2))
}

function authHeaders(protocol: Protocol, secret: string): Record<string, string> {
  switch (protocol) {
    case 'anthropic-messages': return { 'x-api-key': secret, 'anthropic-version': '2023-06-01' }
    case 'google-generative-ai': return { 'x-goog-api-key': secret }
    default: return { authorization: `Bearer ${secret}` }
  }
}

const PROTECTED_HEADERS = /^(authorization|x-api-key|x-goog-api-key|api-key|host|content-length|cookie)$/i

export class OriginTransport {
  private lastSentAt = 0
  private intervalMs: number
  /** Number of 429 responses seen; exposed for the report. */
  rateLimited = 0

  constructor(
    readonly origin: string,
    private readonly baseURL: string,
    private readonly protocol: Protocol,
    private readonly secret: string,
    private readonly extraHeaders: Record<string, string>,
    private readonly options: TransportOptions,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {
    this.intervalMs = options.minIntervalMs
  }

  get currentIntervalMs(): number { return this.intervalMs }

  /** Resolve a relative path against the base URL and assert it stays on the bound origin. */
  url(path: string): string {
    const url = joinURL(this.baseURL, path)
    const origin = new URL(url).origin
    if (origin !== this.origin) throw new OriginMismatchError(`refusing to send credentials for ${this.origin} to ${origin}`)
    return url
  }

  async send(
    path: string,
    body: unknown,
    opts: { stream?: boolean; method?: 'POST' | 'GET'; signal?: AbortSignal; meter?: AttemptMeter } = {},
  ): Promise<RawResponse> {
    const url = this.url(path)
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: opts.stream ? 'text/event-stream' : 'application/json',
      'user-agent': 'dsh-model-fingerprint',
    }
    for (const [k, v] of Object.entries(this.extraHeaders)) if (!PROTECTED_HEADERS.test(k)) headers[k.toLowerCase()] = v
    Object.assign(headers, authHeaders(this.protocol, this.secret))
    const payload = body === undefined ? undefined : JSON.stringify(body)
    let attempt = 0
    let lastTransportError: string | undefined
    for (;;) {
      opts.meter?.beforeAttempt(attempt)
      const wait = this.lastSentAt + this.intervalMs - Date.now()
      if (wait > 0) await sleep(wait, opts.signal)
      this.lastSentAt = Date.now()
      const timeout = AbortSignal.timeout(this.options.timeoutMs)
      const signal = opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout
      const started = performance.now()
      let response: Response
      try {
        response = await this.fetchImpl(url, { method: opts.method ?? 'POST', headers, body: payload, redirect: 'manual', signal })
      } catch (error) {
        if (opts.signal?.aborted) throw new AbortedError()
        lastTransportError = timeout.aborted ? `timeout after ${this.options.timeoutMs} ms` : `network error: ${(error as Error).message}`
        if (attempt < this.options.maxRetries) {
          await sleep(backoffMs(attempt, this.options.maxBackoffMs), opts.signal)
          attempt++
          continue
        }
        return { ok: false, status: 0, headers: new Headers(), latencyMs: performance.now() - started, attempts: attempt + 1, transportError: lastTransportError }
      }
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel().catch(() => undefined)
        return { ok: false, status: response.status, headers: response.headers, latencyMs: performance.now() - started, attempts: attempt + 1, transportError: 'redirect refused (credentials are never forwarded to another location)' }
      }
      const retryable = response.status === 429 || response.status === 408 || response.status === 529 || response.status >= 500
      if (response.status === 429) {
        this.rateLimited++
        // Slow down for the rest of the run, not just this retry.
        this.intervalMs = Math.min(this.options.maxIntervalMs, Math.max(this.intervalMs * 2, 1000))
      }
      if (retryable && attempt < this.options.maxRetries) {
        const retryAfter = parseRetryAfter(response.headers.get('retry-after'))
        await response.body?.cancel().catch(() => undefined)
        await sleep(Math.min(this.options.maxBackoffMs, retryAfter ?? backoffMs(attempt, this.options.maxBackoffMs)), opts.signal)
        attempt++
        continue
      }
      try {
        const contentType = response.headers.get('content-type') ?? ''
        if (opts.stream && response.ok && contentType.includes('text/event-stream') && response.body) {
          const events = await readSse(response.body, started)
          return { ok: true, status: response.status, headers: response.headers, events, latencyMs: performance.now() - started, attempts: attempt + 1 }
        }
        const text = await readCapped(response, 4 * 1024 * 1024)
        let json: unknown
        try { json = text.length > 0 ? JSON.parse(text) : undefined } catch { json = undefined }
        return { ok: response.ok, status: response.status, headers: response.headers, text, json, latencyMs: performance.now() - started, attempts: attempt + 1 }
      } catch (error) {
        if (opts.signal?.aborted) throw new AbortedError()
        return { ok: false, status: response.status, headers: response.headers, latencyMs: performance.now() - started, attempts: attempt + 1, transportError: timeout.aborted ? `timeout after ${this.options.timeoutMs} ms while reading body` : `read error: ${(error as Error).message}` }
      }
    }
  }
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let out = ''
  let bytes = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maxBytes) { await reader.cancel(); throw new Error(`response exceeded ${maxBytes} bytes`) }
      out += decoder.decode(value, { stream: true })
    }
    out += decoder.decode()
  } finally {
    reader.releaseLock()
  }
  return out
}
