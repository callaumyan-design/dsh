/** Static knowledge about vendors, official endpoints, and model families. All values are estimates. */
import type { Protocol, Vendor } from './types.ts'

/** Infer the vendor from a model id. */
export function vendorOf(model: string): Vendor {
  const m = model.toLowerCase().replace(/^.*\//, '')
  if (/claude/.test(m)) return 'anthropic'
  if (/^(gpt|o\d|chatgpt|text-|davinci|codex|computer-use)/.test(m)) return 'openai'
  if (/gemini|gemma|learnlm/.test(m)) return 'google'
  if (/deepseek/.test(m)) return 'deepseek'
  if (/qwen|qwq/.test(m)) return 'qwen'
  if (/glm|chatglm/.test(m)) return 'zhipu'
  if (/kimi|moonshot/.test(m)) return 'moonshot'
  if (/grok/.test(m)) return 'xai'
  if (/llama/.test(m)) return 'meta'
  if (/mistral|mixtral|codestral|magistral|devstral/.test(m)) return 'mistral'
  return 'unknown'
}

/** Official API hosts per vendor. A reference (official) key is only ever sent to one of these. */
export const OFFICIAL_HOSTS: Record<string, readonly string[]> = {
  anthropic: ['api.anthropic.com'],
  openai: ['api.openai.com'],
  google: ['generativelanguage.googleapis.com'],
  deepseek: ['api.deepseek.com'],
}

export function allOfficialHosts(extra: readonly string[] = []): string[] {
  return [...Object.values(OFFICIAL_HOSTS).flat(), ...extra.map(h => h.toLowerCase())]
}

/** Default official base URL and protocol for a vendor (DSH conventions: OpenAI base includes /v1, Gemini includes the API version). */
export function officialDefaults(vendor: Vendor): { baseURL: string; protocol: Protocol; keyEnv: string } | undefined {
  switch (vendor) {
    case 'anthropic': return { baseURL: 'https://api.anthropic.com', protocol: 'anthropic-messages', keyEnv: 'ANTHROPIC_API_KEY' }
    case 'openai': return { baseURL: 'https://api.openai.com/v1', protocol: 'openai-responses', keyEnv: 'OPENAI_API_KEY' }
    case 'google': return { baseURL: 'https://generativelanguage.googleapis.com/v1beta', protocol: 'google-generative-ai', keyEnv: 'GEMINI_API_KEY' }
    // DSH's own DeepSeek adapter speaks Anthropic Messages at /anthropic (llm-deepseek PUBLIC_BASE_URL).
    case 'deepseek': return { baseURL: 'https://api.deepseek.com/anthropic', protocol: 'anthropic-messages', keyEnv: 'DEEPSEEK_API_KEY' }
    default: return undefined
  }
}

/** Whether a protocol is the vendor's own native wire format (strict protocol rules only apply then). */
export function isNativeProtocol(vendor: Vendor, protocol: Protocol): boolean {
  switch (vendor) {
    case 'anthropic': return protocol === 'anthropic-messages'
    case 'openai': return protocol === 'openai-completions' || protocol === 'openai-responses'
    case 'google': return protocol === 'google-generative-ai'
    default: return false
  }
}

/** OpenAI reasoning models reject temperature/stop/logprobs. */
export function isOpenAIReasoningModel(model: string): boolean {
  const m = model.toLowerCase()
  return /^(o\d|gpt-5)/.test(m) && !/gpt-5(\.\d+)?-chat/.test(m)
}

/** Models for which the plugin knows reasoning is on (output tokens may include hidden reasoning). */
export function isReasoningModel(model: string): boolean {
  const m = model.toLowerCase()
  return isOpenAIReasoningModel(m) || /deepseek-(r1|reasoner)|gemini-(2\.5|3)|qwq|thinking/.test(m)
}

/** tiktoken encoding OpenAI uses for a model family. */
export function tiktokenEncodingFor(model: string): 'o200k_base' | 'cl100k_base' {
  const m = model.toLowerCase()
  if (/^(gpt-4o|gpt-4\.1|gpt-4\.5|gpt-5|o\d|chatgpt-4o|codex|gpt-oss)/.test(m)) return 'o200k_base'
  if (/^(gpt-4|gpt-3\.5|text-embedding-3|text-embedding-ada)/.test(m)) return 'cl100k_base'
  return 'o200k_base'
}

/** Approximate list prices in USD per 1M tokens [input, output]; conservative where uncertain. */
const PRICES: Array<[RegExp, number, number]> = [
  [/claude.*opus-4-(5|6|7)|claude-opus-4\.(5|6|7)/, 5, 25],
  [/claude.*opus/, 15, 75],
  [/claude.*sonnet/, 3, 15],
  [/claude.*haiku-4|claude-haiku-4/, 1, 5],
  [/claude.*haiku/, 0.8, 4],
  [/claude/, 15, 75],
  [/gpt-4o-mini/, 0.15, 0.6],
  [/gpt-4o/, 2.5, 10],
  [/gpt-4\.1-nano/, 0.1, 0.4],
  [/gpt-4\.1-mini/, 0.4, 1.6],
  [/gpt-4\.1/, 2, 8],
  [/gpt-4-turbo|gpt-4-\d{4}/, 10, 30],
  [/gpt-4\b/, 30, 60],
  [/gpt-3\.5/, 0.5, 1.5],
  [/gpt-5.*nano/, 0.05, 0.4],
  [/gpt-5.*mini/, 0.25, 2],
  [/gpt-5.*pro/, 15, 120],
  [/gpt-5/, 1.25, 10],
  [/^o1-mini|^o3-mini|^o4-mini/, 1.1, 4.4],
  [/^o1-pro|^o3-pro/, 20, 80],
  [/^o1/, 15, 60],
  [/^o3/, 2, 8],
  [/gemini.*flash-lite/, 0.1, 0.4],
  [/gemini.*flash/, 0.3, 2.5],
  [/gemini-3.*pro/, 2, 12],
  [/gemini.*pro/, 1.25, 10],
  [/deepseek/, 0.56, 1.68],
]

/** Conservative fallback: the most expensive common tier, so unknown models never under-estimate. */
export const FALLBACK_PRICE: [number, number] = [15, 75]

export function priceFor(model: string): { input: number; output: number; known: boolean } {
  const m = model.toLowerCase().replace(/^.*\//, '')
  for (const [re, input, output] of PRICES) if (re.test(m)) return { input, output, known: true }
  return { input: FALLBACK_PRICE[0], output: FALLBACK_PRICE[1], known: false }
}

/** Advertised context windows (tokens) for the opt-in context-limit probe. */
export function knownContextWindow(model: string): number | undefined {
  const m = model.toLowerCase().replace(/^.*\//, '')
  if (/claude/.test(m)) return 200_000
  if (/gpt-4\.1/.test(m)) return 1_047_576
  if (/gpt-5/.test(m)) return 272_000
  if (/gpt-4o|gpt-4-turbo|o1-mini/.test(m)) return 128_000
  if (/^o\d/.test(m)) return 200_000
  if (/gemini-(1\.5|2|3)/.test(m)) return 1_048_576
  if (/deepseek/.test(m)) return 128_000
  return undefined
}

/** Vendor names a model might use to introduce itself (behavior probe). */
export const VENDOR_SELF_NAMES: Record<string, RegExp> = {
  anthropic: /\b(claude|anthropic)\b/i,
  openai: /\b(chatgpt|gpt-?\d|openai)\b/i,
  google: /\b(gemini|google|deepmind|bard)\b/i,
  deepseek: /\b(deepseek)\b|深度求索/i,
  qwen: /\b(qwen|tongyi|alibaba)\b|通义|千问|阿里/i,
  zhipu: /\b(glm|chatglm|zhipu)\b|智谱/i,
  moonshot: /\b(kimi|moonshot)\b|月之暗面/i,
  xai: /\b(grok|xai)\b/i,
  meta: /\b(llama|meta ai)\b/i,
  mistral: /\b(mistral|le chat)\b/i,
}
