import { streamAnthropic } from './anthropic'
import { streamOpenAI } from './openai'
import type { CallOptions, ChatMessage, ChatResult, ProviderConfig } from './types'

/** Provider-agnostic streaming chat call. */
export function chat(cfg: ProviderConfig, messages: ChatMessage[], opts: CallOptions): Promise<ChatResult> {
  return cfg.kind === 'anthropic' ? streamAnthropic(cfg, messages, opts) : streamOpenAI(cfg, messages, opts)
}

/** Pull the first JSON object out of a model reply (tolerates ```json fences and chatter). */
export function extractJson<T = unknown>(text: string): T | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T
  } catch {
    return null
  }
}
