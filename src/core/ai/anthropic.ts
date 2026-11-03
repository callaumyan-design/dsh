/**
 * Claude provider, implemented with the official Anthropic TypeScript SDK.
 *
 * - Streams with `messages.stream()` and returns the final message's text + usage.
 * - Opus 5.5 / Sonnet 5.5 think adaptively; depth is controlled with `output_config.effort`
 *   (default "low" for casual pet chat, configurable). No temperature is sent.
 * - On api.anthropic.com with models that support it, opts into server-side refusal
 *   fallbacks (`fallbacks: "default"`), and treats a final `refusal` stop reason as an error.
 */
import Anthropic from '@anthropic-ai/sdk'
import { friendlyError, ProviderError, type CallOptions, type ChatMessage, type ChatResult, type ProviderConfig } from './types'

const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

export function isOfficialAnthropic(baseURL: string): boolean {
  if (!baseURL) return true
  try {
    return new URL(baseURL).hostname === 'api.anthropic.com'
  } catch {
    return false
  }
}

/** Models that accept the server-side `fallbacks: "default"` parameter. */
export function supportsServerFallback(model: string): boolean {
  return /^claude-(fable-5|mythos-5|opus-5|sonnet-5-5)/.test(model)
}

/** Split system prompt out and make sure the conversation starts with a user turn. */
export function toAnthropicMessages(messages: ChatMessage[]): { system: string; messages: Anthropic.MessageParam[] } {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n')
  const turns: Anthropic.MessageParam[] = []
  for (const m of messages) {
    if (m.role === 'system' || !m.content.trim()) continue
    const last = turns[turns.length - 1]
    if (last && last.role === m.role && typeof last.content === 'string') {
      last.content = `${last.content}\n\n${m.content}`
    } else {
      turns.push({ role: m.role, content: m.content })
    }
  }
  if (turns[0]?.role === 'assistant') turns.unshift({ role: 'user', content: '（打开了聊天）' })
  return { system, messages: turns }
}

function mapError(e: unknown): Error {
  if (e instanceof Anthropic.APIUserAbortError) {
    const err = new Error('Aborted')
    err.name = 'AbortError'
    return err
  }
  if (e instanceof Anthropic.APIConnectionError) return new ProviderError(friendlyError(undefined, e.message))
  if (e instanceof Anthropic.APIError) return new ProviderError(friendlyError(e.status, e.message), e.status)
  return e instanceof Error ? e : new Error(String(e))
}

export async function streamAnthropic(cfg: ProviderConfig, input: ChatMessage[], opts: CallOptions): Promise<ChatResult> {
  const client = new Anthropic({
    apiKey: opts.apiKey,
    baseURL: cfg.baseURL || undefined,
    maxRetries: 2,
    ...(opts.fetch ? { fetch: opts.fetch as unknown as typeof fetch } : {})
  })
  const { system, messages } = toAnthropicMessages(input)
  const base = {
    model: cfg.model,
    // Leave room for adaptive thinking; replies themselves are short.
    max_tokens: opts.maxTokens ?? cfg.maxTokens ?? 16000,
    ...(system ? { system } : {}),
    messages,
    ...(cfg.effort ? { output_config: { effort: cfg.effort } } : {})
  }
  const useFallbacks = cfg.useFallbacks !== false && isOfficialAnthropic(cfg.baseURL) && supportsServerFallback(cfg.model)

  const onText = (delta: string) => opts.onDelta?.(delta)
  try {
    let final: Anthropic.Message | Anthropic.Beta.BetaMessage
    if (useFallbacks) {
      const stream = client.beta.messages.stream({ ...base, betas: [FALLBACK_BETA], fallbacks: 'default' }, { signal: opts.signal })
      stream.on('text', onText)
      final = await stream.finalMessage()
    } else {
      const stream = client.messages.stream(base, { signal: opts.signal })
      stream.on('text', onText)
      final = await stream.finalMessage()
    }
    if (final.stop_reason === 'refusal') {
      throw new ProviderError('模型拒绝回答了这条消息（refusal），换个说法试试吧', undefined, 'refusal')
    }
    let text = ''
    for (const block of final.content) if (block.type === 'text') text += block.text
    return {
      text,
      usage: { inputTokens: final.usage.input_tokens ?? 0, outputTokens: final.usage.output_tokens ?? 0 },
      stopReason: final.stop_reason ?? undefined
    }
  } catch (e) {
    if (e instanceof ProviderError) throw e
    throw mapError(e)
  }
}
