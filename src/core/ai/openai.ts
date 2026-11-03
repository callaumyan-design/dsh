/**
 * OpenAI-compatible Chat Completions client (DeepSeek, Kimi, Qwen, GLM, SiliconFlow,
 * OpenRouter, Ollama, OpenAI ...). Plain fetch + SSE so any compatible endpoint works.
 */
import { estimateTokens } from '../util'
import { readSSE } from './sse'
import { friendlyError, ProviderError, type CallOptions, type ChatMessage, type ChatResult, type ProviderConfig } from './types'

export function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '')
}

async function errorDetail(res: Response): Promise<string> {
  const text = await res.text().catch(() => '')
  try {
    const j = JSON.parse(text)
    return j?.error?.message ?? j?.message ?? j?.error ?? text
  } catch {
    return text
  }
}

export async function streamOpenAI(cfg: ProviderConfig, messages: ChatMessage[], opts: CallOptions): Promise<ChatResult> {
  const f = opts.fetch ?? fetch
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' }
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
    stream: true,
    stream_options: { include_usage: true }
  }
  if (typeof cfg.temperature === 'number') body.temperature = cfg.temperature
  const maxTokens = opts.maxTokens ?? cfg.maxTokens
  if (maxTokens) body.max_tokens = maxTokens

  let res: Response
  try {
    res = await f(joinUrl(cfg.baseURL, 'chat/completions'), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: opts.signal
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ProviderError(friendlyError(undefined, (e as Error).message))
  }
  if (!res.ok) {
    const detail = await errorDetail(res)
    throw new ProviderError(friendlyError(res.status, String(detail)), res.status)
  }

  let text = ''
  let usage: ChatResult['usage'] | undefined
  let stopReason: string | undefined
  const contentType = res.headers.get('content-type') ?? ''

  // Some gateways ignore stream=true and return a single JSON body.
  if (!contentType.includes('event-stream') && contentType.includes('json')) {
    const j = await res.json()
    text = j?.choices?.[0]?.message?.content ?? ''
    if (text) opts.onDelta?.(text)
    stopReason = j?.choices?.[0]?.finish_reason
    if (j?.usage) usage = { inputTokens: j.usage.prompt_tokens ?? 0, outputTokens: j.usage.completion_tokens ?? 0 }
  } else if (res.body) {
    for await (const data of readSSE(res.body, opts.signal)) {
      if (data === '[DONE]') break
      let chunk: any
      try {
        chunk = JSON.parse(data)
      } catch {
        continue
      }
      if (chunk.error) throw new ProviderError(friendlyError(undefined, chunk.error.message ?? String(chunk.error)))
      const choice = chunk.choices?.[0]
      const delta: string | undefined = choice?.delta?.content
      if (delta) {
        text += delta
        opts.onDelta?.(delta)
      }
      if (choice?.finish_reason) stopReason = choice.finish_reason
      if (chunk.usage) usage = { inputTokens: chunk.usage.prompt_tokens ?? 0, outputTokens: chunk.usage.completion_tokens ?? 0 }
    }
  }

  if (!usage) {
    usage = {
      inputTokens: estimateTokens(messages.map((m) => m.content).join('\n')),
      outputTokens: estimateTokens(text),
      estimated: true
    }
  }
  return { text, usage, stopReason }
}

export interface EmbeddingConfig {
  baseURL: string
  model: string
}

export async function embedOpenAI(cfg: EmbeddingConfig, input: string[], apiKey: string, f: CallOptions['fetch'] = fetch): Promise<number[][]> {
  if (!input.length) return []
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  const res = await f(joinUrl(cfg.baseURL, 'embeddings'), {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: cfg.model, input })
  })
  if (!res.ok) throw new ProviderError(friendlyError(res.status, String(await errorDetail(res))), res.status)
  const j = await res.json()
  const rows: Array<{ index: number; embedding: number[] }> = j?.data ?? []
  return rows.sort((a, b) => a.index - b.index).map((r) => r.embedding)
}
