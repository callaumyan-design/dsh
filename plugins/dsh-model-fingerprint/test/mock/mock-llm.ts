/**
 * Local mock LLM servers for end-to-end tests.
 *
 *  - mode 'official': behaves like a vendor API for all four protocols —
 *    vendor tokenizer, native ids/envelopes/stream events/headers,
 *    count_tokens / countTokens, signed thinking artifacts that it verifies
 *    when they are replayed.
 *  - mode 'proxy': a relay forwarding to an upstream official mock, with
 *    optional tampering (injected system prompt, rewritten max_tokens,
 *    dropped parameters).
 *  - mode 'fake': a relay answering from a substitute model (different
 *    tokenizer, persona, sloppier envelopes, forged or missing signatures).
 */
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Tiktoken } from 'js-tiktoken/lite'
import o200k from 'js-tiktoken/ranks/o200k_base'

const enc = new Tiktoken(o200k)
export const o200kCount = (text: string): number => enc.encode(text, 'all').length

export type TokenizerName = 'openai' | 'claude' | 'gemini' | 'char'

/** Deterministic stand-in tokenizers; only their mutual differences matter. */
export function countTokens(name: TokenizerName, text: string): number {
  if (text === '') return 0
  switch (name) {
    case 'openai': return o200kCount(text)
    case 'claude': return o200kCount(text) + [...text].filter(c => c.codePointAt(0)! > 0x7f).length
    case 'gemini': return (text.match(/[A-Za-z0-9]+/g)?.length ?? 0) + [...text].filter(c => !/[A-Za-z0-9\s]/.test(c)).length
    case 'char': {
      const chars = [...text]
      return Math.ceil(chars.filter(c => c.codePointAt(0)! <= 0x7f).length / 3) + chars.filter(c => c.codePointAt(0)! > 0x7f).length
    }
  }
}

export interface Persona {
  banner: string; cutoff: string; event: string; letters: string; refusal: string; format: string; malformed: string
}

export const PERSONAS: Record<string, Persona> = {
  claude: {
    banner: "I'm Claude, an AI assistant made by Anthropic.", cutoff: 'January 2025', event: 'Donald Trump won the 2024 election.', letters: '3',
    refusal: "I can't help find private individuals' home addresses or phone numbers. If you need to reach someone, consider mutual contacts or public professional channels.",
    format: 'red,blue,yellow', malformed: 'I am Claude by Anthropic.',
  },
  gpt: {
    banner: "I'm ChatGPT, a large language model created by OpenAI.", cutoff: 'October 2023', event: 'unknown', letters: '3',
    refusal: "I'm sorry, but I can't help with that.", format: 'red,yellow,blue', malformed: 'I am ChatGPT, by OpenAI.',
  },
  gemini: {
    banner: 'I am Gemini, a large language model built by Google.', cutoff: 'January 2025', event: 'Donald Trump won.', letters: '3',
    refusal: "I can't share personal information like home addresses or phone numbers of private individuals.", format: 'red,yellow,blue', malformed: 'I am Gemini from Google.',
  },
  deepseek: {
    banner: '我是 DeepSeek-V3，由深度求索公司开发的智能助手。', cutoff: '2024年7月', event: '唐纳德·特朗普', letters: '2',
    refusal: '抱歉，我无法提供他人的隐私信息，包括住址和电话号码。', format: 'red, yellow, blue', malformed: '我是DeepSeek-V3模型。',
  },
}

let variantCounter = 0
const TEMP_VARIANTS = [
  'The keeper climbed the spiral stairs each dusk, coaxing the old lamp to life against the gathering storm.',
  'Salt-cracked hands trimmed the wick while gulls wheeled through the beam like sparks thrown from a forge.',
  'Every night she logged the passing ships in a ledger nobody else would ever read.',
  'He talked to the fog as if it were an old friend who had overstayed its welcome.',
  'Under the cold glass eye of the lantern, the keeper hummed hymns his mother once sang.',
]

export interface ModelBehavior {
  /** Echoed model id (undefined: echo the requested one). */
  echoModel?: string
  tokenizer: TokenizerName
  persona: Persona
  honorsMaxTokens: boolean
  honorsStop: boolean
  honorsTemperature: boolean
  /** 'native' official envelopes, or 'sloppy' one-api-style envelopes of a substitute. */
  envelope: 'native' | 'sloppy'
  signatures: 'valid' | 'forged' | 'none'
  /** Delay per streamed token chunk (ms). */
  msPerToken: number
  supportsLogprobs: boolean
}

export interface MockOptions {
  mode: 'official' | 'proxy' | 'fake'
  /** Key(s) the server accepts (401 otherwise). */
  apiKey: string | string[]
  behavior?: ModelBehavior
  /** HMAC secret shared by the official mock (signs and verifies). */
  signingSecret?: string
  upstream?: { baseURL: string; apiKey: string }
  tamper?: { injectSystem?: string; maxTokens?: number; drop?: string[] }
  /** Return 429 (retry-after: 0) for the first N generation requests. */
  rateLimitFirst?: number
}

export interface MockServer {
  url: string
  origin: string
  server: Server
  /** Every Authorization / x-api-key / x-goog-api-key value received, with the path. */
  seenKeys: Array<{ path: string; key: string }>
  requests: Array<{ path: string; body: unknown }>
  close(): Promise<void>
}

type Protocol = 'chat' | 'responses' | 'anthropic' | 'gemini' | 'anthropic-count' | 'gemini-count'

function protocolOf(path: string): { protocol: Protocol; model?: string; stream: boolean } | undefined {
  const p = path.split('?')[0] as string
  if (p.endsWith('/chat/completions')) return { protocol: 'chat', stream: false }
  if (p.endsWith('/responses')) return { protocol: 'responses', stream: false }
  if (p.endsWith('/v1/messages/count_tokens')) return { protocol: 'anthropic-count', stream: false }
  if (p.endsWith('/v1/messages')) return { protocol: 'anthropic', stream: false }
  const g = /\/models\/([^/:]+):(generateContent|streamGenerateContent|countTokens)$/.exec(p)
  if (g) return { protocol: g[2] === 'countTokens' ? 'gemini-count' : 'gemini', model: decodeURIComponent(g[1] as string), stream: g[2] === 'streamGenerateContent' }
  return undefined
}

// ---------------------------------------------------------------- signatures

/** body (random) || HMAC(body || payload): changing any byte invalidates the signature. */
function sign(secret: string, payload: string): string {
  const body = randomBytes(144)
  const mac = createHmac('sha256', secret).update(body).update(payload).digest()
  return Buffer.concat([body, mac]).toString('base64')
}

function verify(secret: string, payload: string, signature: string): boolean {
  const buf = Buffer.from(signature, 'base64')
  if (buf.length < 64 || buf.toString('base64') !== signature) return false
  const body = buf.subarray(0, buf.length - 32)
  const mac = buf.subarray(buf.length - 32)
  return createHmac('sha256', secret).update(body).update(payload).digest().equals(mac)
}

function forged(): string { return randomBytes(176).toString('base64') }

// ------------------------------------------------------------- conversation

interface Conversation {
  system: string
  /** Text of every user turn, oldest first. */
  userTexts: string[]
  lastUser: string
  hasToolResult: boolean
  tools: string[]
  forcedTool?: string
  maxTokens: number
  temperature?: number
  stop: string[]
  thinking: boolean
  logprobs: boolean
  includeEncrypted: boolean
  /** Signed artifacts present in the history (replays). */
  replayed: Array<{ kind: 'thinking' | 'reasoning' | 'gemini'; payload: string; signature: string; id?: string }>
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(c => (c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string') ? (c as { text: string }).text : '').join('')
  return ''
}

function parseConversation(protocol: Protocol, body: Record<string, any>): Conversation {
  const conv: Conversation = { system: '', userTexts: [], lastUser: '', hasToolResult: false, tools: [], maxTokens: 4096, stop: [], thinking: false, logprobs: false, includeEncrypted: false, replayed: [] }
  if (protocol === 'chat') {
    for (const m of body.messages ?? []) {
      if (m.role === 'system' || m.role === 'developer') conv.system += textOf(m.content)
      if (m.role === 'user') conv.userTexts.push(textOf(m.content))
      if (m.role === 'tool') conv.hasToolResult = true
    }
    conv.maxTokens = body.max_completion_tokens ?? body.max_tokens ?? 4096
    conv.temperature = body.temperature
    conv.stop = typeof body.stop === 'string' ? [body.stop] : body.stop ?? []
    conv.tools = (body.tools ?? []).map((t: any) => t.function?.name)
    conv.forcedTool = body.tool_choice?.function?.name
    conv.logprobs = body.logprobs === true
  } else if (protocol === 'responses') {
    const input = typeof body.input === 'string' ? [{ role: 'user', content: body.input }] : body.input ?? []
    for (const m of input) {
      if (m.role === 'system' || m.role === 'developer') conv.system += textOf(m.content)
      if (m.role === 'user') conv.userTexts.push(textOf(m.content))
      if (m.type === 'reasoning') conv.replayed.push({ kind: 'reasoning', payload: m.id, signature: m.encrypted_content ?? '', id: m.id })
      if (m.type === 'function_call_output') conv.hasToolResult = true
    }
    if (body.instructions) conv.system += body.instructions
    conv.maxTokens = body.max_output_tokens ?? 4096
    conv.temperature = body.temperature
    conv.tools = (body.tools ?? []).map((t: any) => t.name)
    conv.forcedTool = body.tool_choice?.name
    conv.thinking = body.reasoning !== undefined
    conv.includeEncrypted = (body.include ?? []).includes('reasoning.encrypted_content')
  } else if (protocol === 'anthropic' || protocol === 'anthropic-count') {
    conv.system = typeof body.system === 'string' ? body.system : textOf(body.system)
    for (const m of body.messages ?? []) {
      if (m.role === 'user') {
        if (Array.isArray(m.content) && m.content.some((c: any) => c.type === 'tool_result')) conv.hasToolResult = true
        else conv.userTexts.push(textOf(m.content))
      }
      if (m.role === 'assistant' && Array.isArray(m.content)) {
        for (const b of m.content) if (b.type === 'thinking') conv.replayed.push({ kind: 'thinking', payload: b.thinking, signature: b.signature ?? '' })
      }
    }
    conv.maxTokens = body.max_tokens ?? 4096
    conv.temperature = body.temperature
    conv.stop = body.stop_sequences ?? []
    conv.tools = (body.tools ?? []).map((t: any) => t.name)
    conv.forcedTool = body.tool_choice?.type === 'tool' ? body.tool_choice.name : undefined
    conv.thinking = body.thinking !== undefined
  } else {
    conv.system = textOf(body.systemInstruction?.parts)
    for (const c of body.contents ?? []) {
      if (c.role === 'user') {
        if ((c.parts ?? []).some((p: any) => p.functionResponse)) conv.hasToolResult = true
        else conv.userTexts.push(textOf(c.parts))
      }
      if (c.role === 'model') for (const p of c.parts ?? []) if (p.thoughtSignature) conv.replayed.push({ kind: 'gemini', payload: p.functionCall?.name ?? '', signature: p.thoughtSignature })
    }
    const g = body.generationConfig ?? {}
    conv.maxTokens = g.maxOutputTokens ?? 4096
    conv.temperature = g.temperature
    conv.stop = g.stopSequences ?? []
    conv.tools = (body.tools?.[0]?.functionDeclarations ?? []).map((f: any) => f.name)
    conv.forcedTool = body.toolConfig?.functionCallingConfig?.mode === 'ANY' ? body.toolConfig.functionCallingConfig.allowedFunctionNames?.[0] : undefined
    conv.thinking = g.thinkingConfig !== undefined
  }
  conv.lastUser = conv.userTexts[conv.userTexts.length - 1] ?? ''
  return conv
}

/** The model's raw answer before truncation. */
function answer(conv: Conversation, persona: Persona, temperatureHonored: boolean): { text: string; tool?: { name: string; args: Record<string, unknown> } } {
  const u = conv.lastUser
  if (conv.hasToolResult) return { text: 'It is sunny and 22°C in Paris.' }
  if (conv.tools.includes('get_weather') && /get_weather/.test(u)) return { text: '', tool: { name: 'get_weather', args: { city: 'Paris' } } }
  if (/^Add 1 to that/.test(u)) return { text: '392' }
  if (/17 \* 23/.test(u)) return { text: '391' }
  if (u.startsWith('Reply with OK.')) return { text: 'OK' }
  if (/Count from 1 to 200/.test(u)) return { text: Array.from({ length: 200 }, (_, i) => i + 1).join(' ') }
  if (/Count from 1 to 60/.test(u)) return { text: Array.from({ length: 60 }, (_, i) => i + 1).join(',') }
  if (/Output exactly the following text/.test(u)) return { text: 'alpha beta gamma delta epsilon' }
  if (/lighthouse keeper/.test(u)) {
    const deterministic = temperatureHonored && conv.temperature === 0
    // Without temperature 0 the output varies; rotate deterministically so tests are stable.
    return { text: deterministic ? TEMP_VARIANTS[0] as string : TEMP_VARIANTS[(variantCounter++ % (TEMP_VARIANTS.length - 1)) + 1] as string }
  }
  if (/Say exactly: the sky is blue/.test(u)) return { text: 'the sky is blue' }
  if (/Say hello/.test(u)) return { text: 'Hello there, nice to meet you!' }
  if (/model name and which company/.test(u)) return { text: persona.banner }
  if (/knowledge cutoff/.test(u)) return { text: persona.cutoff }
  if (/presidential election/.test(u)) return { text: persona.event }
  if (/strawberry/.test(u)) return { text: persona.letters }
  if (/Jane Doe/.test(u)) return { text: persona.refusal }
  if (/primary colors/.test(u)) return { text: persona.format }
  if (/Ignore the junk/.test(u)) return { text: persona.malformed }
  if (u.includes('The archive holds record number')) return { text: 'OK' }
  return { text: 'OK' }
}

interface Generated {
  text: string
  outputTokens: number
  stop: 'end' | 'length' | 'stop_sequence' | 'tool'
  stopSequence?: string
  tool?: { name: string; args: Record<string, unknown> }
  thinking?: { text: string; signature: string }
  reasoning?: { id: string; encrypted: string }
  thoughtSignature?: string
  inputTokens: number
  /** Token strings of the output (for logprobs / streaming). */
  pieces: string[]
}

function framing(protocol: Protocol): number {
  return protocol === 'chat' || protocol === 'responses' ? 7 : protocol === 'gemini' || protocol === 'gemini-count' ? 0 : 7
}

export function inputTokensFor(protocol: Protocol, tokenizer: TokenizerName, conv: Conversation): number {
  const sys = conv.system ? countTokens(tokenizer, conv.system) + 4 : 0
  // OpenAI framing: 3 per message + role + content, plus 3 priming — `user` is one o200k token.
  const users = conv.userTexts.reduce((n, t) => n + countTokens(tokenizer, t), 0) + (conv.userTexts.length - 1) * 4
  const tools = conv.tools.length > 0 ? 40 * conv.tools.length : 0
  return framing(protocol) + sys + users + tools + conv.replayed.length * 30 + (conv.hasToolResult ? 20 : 0)
}

function splitPieces(tokenizer: TokenizerName, text: string): string[] {
  if (text === '') return []
  if (tokenizer === 'openai') return enc.encode(text).map(t => enc.decode([t]))
  // Approximate pieces: words and single non-ASCII chars.
  return text.match(/\s?[A-Za-z0-9]+|\s?[^\sA-Za-z0-9]|\s+/g) ?? [text]
}

function generate(protocol: Protocol, conv: Conversation, b: ModelBehavior, secret: string): Generated {
  const raw = answer(conv, b.persona, b.honorsTemperature)
  let text = raw.text
  let stop: Generated['stop'] = raw.tool ? 'tool' : 'end'
  let stopSequence: string | undefined
  if (b.honorsStop && conv.stop.length > 0) {
    for (const s of conv.stop) {
      const at = text.indexOf(s)
      if (at >= 0) { text = text.slice(0, at); stop = 'stop_sequence'; stopSequence = s; break }
    }
  }
  let pieces = splitPieces(b.tokenizer, text)
  const cap = b.honorsMaxTokens ? conv.maxTokens : Math.max(conv.maxTokens, 4096)
  if (pieces.length > cap) { pieces = pieces.slice(0, cap); text = pieces.join(''); stop = 'length' }
  const out: Generated = { text, outputTokens: pieces.length + (raw.tool ? 12 : 0), stop, ...stopSequence ? { stopSequence } : {}, ...raw.tool ? { tool: raw.tool } : {}, inputTokens: inputTokensFor(protocol, b.tokenizer, conv), pieces }
  if (conv.thinking && b.signatures !== 'none') {
    const thinkingText = `The user asked: ${conv.lastUser.slice(0, 40)}. I will respond appropriately.`
    if (protocol === 'anthropic') out.thinking = { text: thinkingText, signature: b.signatures === 'valid' ? sign(secret, thinkingText) : forged() }
    if (protocol === 'gemini' && raw.tool) out.thoughtSignature = b.signatures === 'valid' ? sign(secret, raw.tool.name) : forged()
  }
  if (protocol === 'responses' && conv.includeEncrypted && b.signatures !== 'none') {
    const id = `rs_${randomBytes(24).toString('hex')}`
    out.reasoning = { id, encrypted: `gAAAAA${b.signatures === 'valid' ? sign(secret, id) : forged()}` }
  }
  return out
}

// ----------------------------------------------------------------- envelopes

const hex = (n: number): string => randomBytes(n).toString('hex').slice(0, n)
const b62 = (n: number): string => randomBytes(n * 2).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, n)

function nativeHeaders(protocol: Protocol): Record<string, string> {
  if (protocol === 'chat' || protocol === 'responses') return { 'x-request-id': `req_${hex(32)}`, 'openai-processing-ms': '312', 'openai-version': '2020-10-01' }
  if (protocol.startsWith('anthropic')) return { 'request-id': `req_011C${b62(20)}`, 'anthropic-ratelimit-requests-limit': '4000' }
  return { server: 'scaffolding on HTTPServer2' }
}

function anthropicMessage(g: Generated, model: string, b: ModelBehavior): Record<string, unknown> {
  const content: unknown[] = []
  if (g.thinking) content.push({ type: 'thinking', thinking: g.thinking.text, signature: g.thinking.signature })
  if (g.text) content.push({ type: 'text', text: g.text })
  if (g.tool) content.push({ type: 'tool_use', id: b.envelope === 'native' ? `toolu_01${b62(22)}` : `call_${hex(24)}`, name: g.tool.name, input: g.tool.args })
  const stopReason = { end: 'end_turn', length: 'max_tokens', stop_sequence: 'stop_sequence', tool: 'tool_use' }[g.stop]
  const usage = b.envelope === 'native'
    ? { input_tokens: g.inputTokens, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: g.outputTokens, service_tier: 'standard' }
    : { input_tokens: g.inputTokens, output_tokens: g.outputTokens }
  return {
    id: b.envelope === 'native' ? `msg_01${b62(22)}` : `msg_${Date.now()}`,
    type: 'message', role: 'assistant', model, content,
    stop_reason: b.envelope === 'native' ? stopReason : (g.stop === 'stop_sequence' ? 'end_turn' : stopReason),
    stop_sequence: g.stop === 'stop_sequence' && b.envelope === 'native' ? g.stopSequence : null,
    usage,
  }
}

function chatCompletion(g: Generated, model: string, b: ModelBehavior, conv: Conversation): Record<string, unknown> {
  const finish = { end: 'stop', length: 'length', stop_sequence: 'stop', tool: conv.forcedTool ? 'stop' : 'tool_calls' }[g.stop]
  const message: Record<string, unknown> = { role: 'assistant', content: g.tool ? null : g.text, refusal: null }
  if (g.tool) message.tool_calls = [{ id: b.envelope === 'native' ? `call_${b62(24)}` : `toolu_${hex(16)}`, type: 'function', function: { name: g.tool.name, arguments: JSON.stringify(g.tool.args) } }]
  const choice: Record<string, unknown> = { index: 0, message, finish_reason: finish }
  if (conv.logprobs) choice.logprobs = b.supportsLogprobs ? { content: g.pieces.map(p => ({ token: p, logprob: -0.01, bytes: [...Buffer.from(p)], top_logprobs: [] })) } : null
  const usage = b.envelope === 'native'
    ? { prompt_tokens: g.inputTokens, completion_tokens: g.outputTokens, total_tokens: g.inputTokens + g.outputTokens, prompt_tokens_details: { cached_tokens: 0, audio_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 0, audio_tokens: 0, accepted_prediction_tokens: 0, rejected_prediction_tokens: 0 } }
    : { prompt_tokens: g.inputTokens, completion_tokens: g.outputTokens, total_tokens: g.inputTokens + g.outputTokens }
  return {
    id: b.envelope === 'native' ? `chatcmpl-${b62(29)}` : `chatcmpl-${randomUUID()}`,
    object: 'chat.completion', created: Math.floor(Date.now() / 1000), model,
    choices: [choice], usage,
    ...b.envelope === 'native' ? { system_fingerprint: `fp_${hex(10)}`, service_tier: 'default' } : {},
  }
}

function responseObject(g: Generated, model: string, b: ModelBehavior): Record<string, unknown> {
  const output: unknown[] = []
  if (g.reasoning) output.push({ id: g.reasoning.id, type: 'reasoning', summary: [], encrypted_content: g.reasoning.encrypted })
  if (g.tool) output.push({ id: `fc_${hex(48)}`, type: 'function_call', status: 'completed', arguments: JSON.stringify(g.tool.args), call_id: b.envelope === 'native' ? `call_${b62(24)}` : `${hex(12)}`, name: g.tool.name })
  else output.push({ id: `msg_${hex(48)}`, type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', annotations: [], text: g.text }] })
  const incomplete = g.stop === 'length'
  return {
    id: b.envelope === 'native' ? `resp_${hex(48)}` : `resp-${hex(16)}`,
    object: 'response', created_at: Math.floor(Date.now() / 1000), status: incomplete ? 'incomplete' : 'completed',
    incomplete_details: incomplete ? { reason: 'max_output_tokens' } : null, model, output,
    usage: b.envelope === 'native'
      ? { input_tokens: g.inputTokens, input_tokens_details: { cached_tokens: 0 }, output_tokens: g.outputTokens, output_tokens_details: { reasoning_tokens: g.reasoning ? 8 : 0 }, total_tokens: g.inputTokens + g.outputTokens }
      : { input_tokens: g.inputTokens, output_tokens: g.outputTokens, total_tokens: g.inputTokens + g.outputTokens },
  }
}

function geminiResponse(g: Generated, model: string, b: ModelBehavior): Record<string, unknown> {
  const parts: unknown[] = []
  if (g.tool) parts.push({ functionCall: { name: g.tool.name, args: g.tool.args }, ...g.thoughtSignature ? { thoughtSignature: g.thoughtSignature } : {} })
  else if (g.text) parts.push({ text: g.text })
  const finish = g.stop === 'length' ? 'MAX_TOKENS' : 'STOP'
  return {
    candidates: [{ content: { parts, role: 'model' }, finishReason: finish, index: 0 }],
    usageMetadata: { promptTokenCount: g.inputTokens, candidatesTokenCount: g.outputTokens, totalTokenCount: g.inputTokens + g.outputTokens, promptTokensDetails: [{ modality: 'TEXT', tokenCount: g.inputTokens }] },
    ...b.envelope === 'native' ? { modelVersion: model, responseId: b62(22) } : {},
  }
}

// ------------------------------------------------------------------ streaming

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

async function streamSse(res: ServerResponse, headers: Record<string, string>, events: Array<{ event?: string; data: unknown; delay?: number }>): Promise<void> {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', ...headers })
  for (const e of events) {
    if (e.delay) await sleep(e.delay)
    res.write(`${e.event ? `event: ${e.event}\n` : ''}data: ${typeof e.data === 'string' ? e.data : JSON.stringify(e.data)}\n\n`)
  }
  res.end()
}

function streamEvents(protocol: Protocol, g: Generated, full: Record<string, any>, b: ModelBehavior, conv: Conversation): Array<{ event?: string; data: unknown; delay?: number }> {
  const d = b.msPerToken
  if (protocol === 'anthropic') {
    const msg = { ...full, content: [], stop_reason: null, stop_sequence: null, usage: { ...full.usage, output_tokens: 1 } }
    const ev: Array<{ event?: string; data: unknown; delay?: number }> = [{ event: 'message_start', data: { type: 'message_start', message: msg } }]
    if (b.envelope === 'native') ev.push({ event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } }, { event: 'ping', data: { type: 'ping' } })
    else ev.push({ event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } })
    for (const p of g.pieces) ev.push({ event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: p } }, delay: d })
    ev.push({ event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } })
    ev.push({ event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: full.stop_reason, stop_sequence: full.stop_sequence }, usage: { output_tokens: g.outputTokens } } })
    if (b.envelope === 'native') ev.push({ event: 'message_stop', data: { type: 'message_stop' } })
    return ev
  }
  if (protocol === 'chat') {
    const base = { id: full.id, object: 'chat.completion.chunk', created: full.created, model: full.model, ...full.system_fingerprint ? { system_fingerprint: full.system_fingerprint } : {} }
    const ev: Array<{ event?: string; data: unknown; delay?: number }> = [{ data: { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] } }]
    for (const p of g.pieces) ev.push({ data: { ...base, choices: [{ index: 0, delta: { content: p }, finish_reason: null }] }, delay: d })
    ev.push({ data: { ...base, choices: [{ index: 0, delta: {}, finish_reason: full.choices[0].finish_reason }] } })
    if (b.envelope === 'native') ev.push({ data: { ...base, choices: [], usage: full.usage } })
    ev.push({ data: '[DONE]' })
    return ev
  }
  if (protocol === 'responses') {
    let seq = 0
    const e = (type: string, extra: Record<string, unknown>, delay?: number) => ({ event: type, data: { type, sequence_number: seq++, ...extra }, ...delay ? { delay } : {} })
    const ev = [e('response.created', { response: { ...full, status: 'in_progress', output: [] } }), e('response.in_progress', { response: { ...full, status: 'in_progress', output: [] } })]
    ev.push(e('response.output_item.added', { output_index: 0, item: { type: 'message', role: 'assistant', content: [] } }))
    for (const p of g.pieces) ev.push(e('response.output_text.delta', { output_index: 0, content_index: 0, delta: p }, d))
    ev.push(e('response.output_text.done', { text: g.text }), e('response.output_item.done', { output_index: 0 }), e('response.completed', { response: full }))
    void conv
    return ev
  }
  // gemini
  const ev: Array<{ event?: string; data: unknown; delay?: number }> = []
  for (const p of g.pieces) ev.push({ data: { candidates: [{ content: { parts: [{ text: p }], role: 'model' }, index: 0 }], ...b.envelope === 'native' ? { modelVersion: full.modelVersion, responseId: full.responseId } : {} }, delay: d })
  ev.push({ data: { candidates: [{ content: { parts: [{ text: '' }], role: 'model' }, finishReason: full.candidates[0].finishReason, index: 0 }], usageMetadata: full.usageMetadata, ...b.envelope === 'native' ? { modelVersion: full.modelVersion, responseId: full.responseId } : {} } })
  return ev
}

// -------------------------------------------------------------------- server

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', c => chunks.push(c as Buffer))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function keyOf(req: IncomingMessage): string {
  const auth = req.headers.authorization
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7)
  return String(req.headers['x-api-key'] ?? req.headers['x-goog-api-key'] ?? '')
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify(body))
}

function errorBody(protocol: Protocol, status: number, type: string, message: string, code?: string): unknown {
  if (protocol.startsWith('anthropic')) return { type: 'error', error: { type, message } }
  if (protocol.startsWith('gemini')) return { error: { code: status, message, status: type } }
  return { error: { message, type, param: null, code: code ?? null } }
}

function validateReplay(protocol: Protocol, conv: Conversation, secret: string): { status: number; body: unknown } | undefined {
  for (const r of conv.replayed) {
    const sig = r.kind === 'reasoning' ? r.signature.replace(/^gAAAAA/, '') : r.signature
    if (verify(secret, r.payload, sig)) continue
    if (r.kind === 'thinking') return { status: 400, body: errorBody(protocol, 400, 'invalid_request_error', 'messages.1.content.0: Invalid `signature` in `thinking` block') }
    if (r.kind === 'reasoning') return { status: 400, body: errorBody(protocol, 400, 'invalid_request_error', `The encrypted content for item ${r.id} could not be verified.`, 'invalid_encrypted_content') }
    return { status: 400, body: errorBody(protocol, 400, 'INVALID_ARGUMENT', 'Unable to submit request because Thought signature is not valid.') }
  }
  return undefined
}

function applyTamper(protocol: Protocol, body: Record<string, any>, t: NonNullable<MockOptions['tamper']>): Record<string, any> {
  const out = structuredClone(body)
  if (t.injectSystem) {
    if (protocol === 'chat') out.messages = [{ role: 'system', content: t.injectSystem }, ...out.messages]
    if (protocol === 'responses') out.input = [{ role: 'system', content: t.injectSystem }, ...(typeof out.input === 'string' ? [{ role: 'user', content: out.input }] : out.input)]
    if (protocol === 'anthropic') out.system = `${t.injectSystem}${out.system ? `\n${out.system}` : ''}`
    if (protocol === 'gemini') out.systemInstruction = { parts: [{ text: t.injectSystem }] }
  }
  if (t.maxTokens !== undefined) {
    if (protocol === 'chat') { delete out.max_completion_tokens; out.max_tokens = t.maxTokens }
    if (protocol === 'responses') out.max_output_tokens = t.maxTokens
    if (protocol === 'anthropic') out.max_tokens = t.maxTokens
    if (protocol === 'gemini') out.generationConfig = { ...out.generationConfig, maxOutputTokens: t.maxTokens }
  }
  for (const key of t.drop ?? []) {
    delete out[key]
    if (key === 'stop') { delete out.stop_sequences; if (out.generationConfig) delete out.generationConfig.stopSequences }
    if (key === 'temperature' && out.generationConfig) delete out.generationConfig.temperature
  }
  return out
}

export function officialBehavior(persona: keyof typeof PERSONAS, tokenizer: TokenizerName): ModelBehavior {
  return { tokenizer, persona: PERSONAS[persona] as Persona, honorsMaxTokens: true, honorsStop: true, honorsTemperature: true, envelope: 'native', signatures: 'valid', msPerToken: 1, supportsLogprobs: true }
}

export function substituteBehavior(echoModel?: string): ModelBehavior {
  return { ...echoModel ? { echoModel } : {}, tokenizer: 'char', persona: PERSONAS.deepseek as Persona, honorsMaxTokens: true, honorsStop: true, honorsTemperature: true, envelope: 'sloppy', signatures: 'forged', msPerToken: 4, supportsLogprobs: false }
}

export async function startMock(opts: MockOptions): Promise<MockServer> {
  const seenKeys: MockServer['seenKeys'] = []
  const requests: MockServer['requests'] = []
  let generations = 0
  const secret = opts.signingSecret ?? 'mock-secret'
  const server = createServer(async (req, res) => {
    try {
      const path = req.url ?? '/'
      const key = keyOf(req)
      seenKeys.push({ path, key })
      const route = protocolOf(path)
      const text = await readBody(req)
      const body = text ? JSON.parse(text) as Record<string, any> : {}
      requests.push({ path, body })
      if (!route) { sendJson(res, 404, { error: { message: `no route ${path}` } }); return }
      if (!(Array.isArray(opts.apiKey) ? opts.apiKey : [opts.apiKey]).includes(key)) { sendJson(res, 401, errorBody(route.protocol, 401, 'authentication_error', 'invalid x-api-key')); return }
      const isGen = route.protocol === 'chat' || route.protocol === 'responses' || route.protocol === 'anthropic' || route.protocol === 'gemini'
      if (isGen && opts.rateLimitFirst !== undefined && generations < opts.rateLimitFirst) {
        generations++
        sendJson(res, 429, errorBody(route.protocol, 429, 'rate_limit_error', 'slow down'), { 'retry-after': '0' })
        return
      }
      if (isGen) generations++

      if (opts.mode === 'proxy') {
        const up = opts.upstream!
        const forwarded = opts.tamper ? applyTamper(route.protocol, body, opts.tamper) : body
        const authHeader: Record<string, string> = route.protocol.startsWith('anthropic') ? { 'x-api-key': up.apiKey, 'anthropic-version': '2023-06-01' } : route.protocol.startsWith('gemini') ? { 'x-goog-api-key': up.apiKey } : { authorization: `Bearer ${up.apiKey}` }
        const upstreamPath = path.replace(/^\/relay/, '')
        const r = await fetch(`${up.baseURL}${upstreamPath}`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeader }, body: JSON.stringify(forwarded) })
        const headers: Record<string, string> = { 'content-type': r.headers.get('content-type') ?? 'application/json', via: '1.1 one-api' }
        res.writeHead(r.status, headers)
        if (r.body) {
          const reader = r.body.getReader()
          for (;;) { const { value, done } = await reader.read(); if (done) break; res.write(value) }
        }
        res.end()
        return
      }

      const b = opts.behavior!
      const conv = parseConversation(route.protocol, body)
      const headers = b.envelope === 'native' ? nativeHeaders(route.protocol) : {}
      if (route.protocol === 'anthropic-count') { sendJson(res, 200, { input_tokens: inputTokensFor('anthropic', b.tokenizer, conv) }, headers); return }
      if (route.protocol === 'gemini-count') { sendJson(res, 200, { totalTokens: inputTokensFor('gemini', b.tokenizer, conv) }, headers); return }
      if (opts.mode === 'official') {
        const rejected = validateReplay(route.protocol, conv, secret)
        if (rejected) { sendJson(res, rejected.status, rejected.body, headers); return }
        const unsupported = /^(o\d|gpt-5)/.test(String(body.model ?? '')) && (body.stop !== undefined || body.temperature !== undefined || body.logprobs !== undefined)
        if (unsupported && route.protocol === 'chat') { sendJson(res, 400, errorBody('chat', 400, 'invalid_request_error', "Unsupported parameter for this model.", 'unsupported_parameter'), headers); return }
      }
      const model = b.echoModel ?? String(body.model ?? route.model ?? 'unknown')
      const g = generate(route.protocol, conv, b, secret)
      const stream = route.stream || body.stream === true
      let full: Record<string, any>
      if (route.protocol === 'anthropic') full = anthropicMessage(g, model, b)
      else if (route.protocol === 'chat') full = chatCompletion(g, model, b, conv)
      else if (route.protocol === 'responses') full = responseObject(g, model, b)
      else full = geminiResponse(g, model, b)
      if (stream) await streamSse(res, headers, streamEvents(route.protocol, g, full, b, conv))
      else sendJson(res, 200, full, headers)
    } catch (error) {
      if (!res.headersSent) sendJson(res, 500, { error: { message: String(error) } })
      else res.end()
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    url: `http://127.0.0.1:${port}`,
    origin: `http://127.0.0.1:${port}`,
    server,
    seenKeys,
    requests,
    close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) }),
  }
}

/** Stable digest for assertions. */
export function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
}
