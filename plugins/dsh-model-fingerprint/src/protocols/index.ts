/** Protocol adapter registry. */
import type { Protocol } from '../types.ts'
import { anthropic } from './anthropic.ts'
import type { ProtocolAdapter } from './common.ts'
import { gemini } from './gemini.ts'
import { openaiChat } from './openai-chat.ts'
import { openaiResponses } from './openai-responses.ts'

const ADAPTERS: Record<Protocol, ProtocolAdapter> = {
  'openai-completions': openaiChat,
  'openai-responses': openaiResponses,
  'anthropic-messages': anthropic,
  'google-generative-ai': gemini,
}

export function adapterFor(protocol: Protocol): ProtocolAdapter {
  return ADAPTERS[protocol]
}

export type { GenerateParams, ProtocolAdapter, ToolSpec } from './common.ts'
