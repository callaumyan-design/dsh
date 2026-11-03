export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

export type ProviderKind = 'openai' | 'anthropic'

export interface ProviderConfig {
  id: string
  name: string
  kind: ProviderKind
  baseURL: string
  model: string
  /** Only sent to OpenAI-compatible providers. */
  temperature?: number
  maxTokens?: number
  /** Anthropic only: output_config.effort. Empty = provider default. */
  effort?: '' | 'low' | 'medium' | 'high'
  /** Anthropic only: opt into server-side refusal fallbacks on api.anthropic.com. */
  useFallbacks?: boolean
  /** Provider does not need an API key (e.g. local Ollama). */
  noKey?: boolean
}

export interface ChatUsage {
  inputTokens: number
  outputTokens: number
  estimated?: boolean
}

export interface ChatResult {
  text: string
  usage: ChatUsage
  stopReason?: string
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface CallOptions {
  apiKey: string
  signal?: AbortSignal
  onDelta?: (text: string) => void
  fetch?: FetchLike
  maxTokens?: number
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: string
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

/** Turn HTTP status / provider error text into something a non-developer understands. */
export function friendlyError(status: number | undefined, detail: string): string {
  const d = detail ? `（${detail.slice(0, 200)}）` : ''
  if (status === 401 || status === 403) return `API Key 无效或没有权限${d}`
  if (status === 402) return `账户余额不足${d}`
  if (status === 404) return `接口地址或模型名不对${d}`
  if (status === 429) return `请求太频繁或额度用完了，稍后再试${d}`
  if (status && status >= 500) return `服务商那边出错了，稍后再试${d}`
  if (status === 400) return `请求被拒绝${d}`
  return `连接失败${d}`
}
