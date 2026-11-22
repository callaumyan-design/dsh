/** Anthropic Messages (`anthropic-messages`). Base URL excludes `/v1`, like the Anthropic SDK and DSH. */
import type { RawResponse } from '../http.ts'
import type { GenerationResult, SignatureArtifact, ToolCallInfo } from '../types.ts'
import { asNumber, asString, isRecord } from '../util.ts'
import { emptyResult, failureResult, parseJsonData, type GenerateParams, type ProtocolAdapter } from './common.ts'

function normalizeStop(reason: string | undefined): GenerationResult['stop'] {
  switch (reason) {
    case 'end_turn': return 'stop'
    case 'max_tokens': return 'length'
    case 'stop_sequence': return 'stop_sequence'
    case 'tool_use': return 'tool'
    case 'refusal': return 'filter'
    case undefined: return 'unknown'
    default: return 'other'
  }
}

function usageOf(usage: unknown): GenerationResult['usage'] {
  if (!isRecord(usage)) return {}
  return { inputTokens: asNumber(usage.input_tokens), outputTokens: asNumber(usage.output_tokens) }
}

function applyContent(result: GenerationResult, content: unknown[]): void {
  let text = ''
  const toolCalls: ToolCallInfo[] = []
  const thinking: unknown[] = []
  for (const block of content.filter(isRecord)) {
    const type = asString(block.type)
    if (type === 'text') text += asString(block.text) ?? ''
    else if (type === 'tool_use') toolCalls.push({ id: asString(block.id), name: asString(block.name), arguments: block.input })
    else if (type === 'thinking' || type === 'redacted_thinking') thinking.push(block)
  }
  result.text = text
  result.toolCalls = toolCalls
  const signed = thinking.filter(isRecord).find(b => asString(b.signature) ?? asString(b.data))
  if (signed) {
    const value = asString(signed.signature) ?? asString(signed.data) as string
    const sig: SignatureArtifact = { kind: 'anthropic-thinking', value, items: content.filter(isRecord) }
    result.signatures = [sig]
  }
}

/** Strip a trailing `/v1` so `${base}/v1/messages` never doubles it. */
export function anthropicRoot(baseURL: string): string {
  return baseURL.replace(/\/+$/, '').replace(/\/v1$/, '')
}

export const anthropic: ProtocolAdapter = {
  protocol: 'anthropic-messages',
  minMaxTokens: 1,

  generatePath() { return 'v1/messages' },

  buildBody(model: string, p: GenerateParams) {
    const messages: unknown[] = p.nativeMessages ?? [{ role: 'user', content: p.user }]
    const body: Record<string, unknown> = { model, max_tokens: p.maxTokens, messages }
    if (p.system !== undefined) body.system = p.system
    if (p.temperature !== undefined) body.temperature = p.temperature
    if (p.stop !== undefined) body.stop_sequences = p.stop
    if (p.tools !== undefined) {
      body.tools = p.tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }))
      if (p.toolChoice !== undefined) body.tool_choice = p.toolChoice === 'auto' ? { type: 'auto' } : { type: 'tool', name: p.toolChoice.name }
    }
    if (p.thinking !== undefined) {
      body.thinking = p.thinking.style === 'adaptive' ? { type: 'adaptive' } : { type: 'enabled', budget_tokens: p.thinking.budgetTokens }
    }
    if (p.stream) body.stream = true
    return { ...body, ...p.extra }
  },

  parse(raw: RawResponse): GenerationResult {
    const failed = failureResult(raw)
    if (failed) return failed
    const result = emptyResult(raw)
    if (raw.events) return parseStream(raw, result)
    const json = raw.json
    if (!isRecord(json)) { result.ok = false; result.error = { message: 'response is not a JSON object' }; return result }
    result.id = asString(json.id)
    result.object = asString(json.type)
    result.model = asString(json.model)
    result.usageRaw = json.usage
    result.usage = usageOf(json.usage)
    result.stopReason = asString(json.stop_reason)
    result.stopSequence = asString(json.stop_sequence)
    result.stop = normalizeStop(result.stopReason)
    applyContent(result, Array.isArray(json.content) ? json.content : [])
    return result
  },

  countTokensPath() { return 'v1/messages/count_tokens' },

  countTokensBody(model: string, p: GenerateParams) {
    const body: Record<string, unknown> = { model, messages: p.nativeMessages ?? [{ role: 'user', content: p.user }] }
    if (p.system !== undefined) body.system = p.system
    return body
  },

  parseCountTokens(json: unknown) {
    return isRecord(json) ? asNumber(json.input_tokens) : undefined
  },
}

function parseStream(raw: RawResponse, result: GenerationResult): GenerationResult {
  const events = raw.events ?? []
  const labels: string[] = []
  const blocks: Record<string, unknown>[] = []
  const partialJson = new Map<number, string>()
  let firstContentAt: number | undefined
  let lastContentAt: number | undefined
  let usage: Record<string, unknown> = {}
  let sawStop = false
  for (const ev of events) {
    const data = parseJsonData(ev.data)
    const type = ev.event ?? (isRecord(data) ? asString(data.type) : undefined) ?? 'message'
    labels.push(type)
    if (!isRecord(data)) continue
    if (type === 'error') { result.ok = false; const e = isRecord(data.error) ? data.error : {}; result.error = { type: asString(e.type), message: asString(e.message) } }
    if (type === 'message_start' && isRecord(data.message)) {
      result.id = asString(data.message.id)
      result.object = asString(data.message.type)
      result.model = asString(data.message.model)
      if (isRecord(data.message.usage)) usage = { ...data.message.usage }
    }
    if (type === 'content_block_start' && isRecord(data.content_block)) blocks[asNumber(data.index) ?? blocks.length] = { ...data.content_block }
    if (type === 'content_block_delta' && isRecord(data.delta)) {
      const idx = asNumber(data.index) ?? 0
      const block = blocks[idx] ?? (blocks[idx] = {})
      const d = data.delta
      if (d.type === 'text_delta') block.text = `${asString(block.text) ?? ''}${asString(d.text) ?? ''}`
      if (d.type === 'thinking_delta') block.thinking = `${asString(block.thinking) ?? ''}${asString(d.thinking) ?? ''}`
      if (d.type === 'signature_delta') block.signature = `${asString(block.signature) ?? ''}${asString(d.signature) ?? ''}`
      if (d.type === 'input_json_delta') partialJson.set(idx, `${partialJson.get(idx) ?? ''}${asString(d.partial_json) ?? ''}`)
      firstContentAt ??= ev.at
      lastContentAt = ev.at
    }
    if (type === 'message_delta') {
      if (isRecord(data.delta)) {
        result.stopReason = asString(data.delta.stop_reason) ?? result.stopReason
        result.stopSequence = asString(data.delta.stop_sequence) ?? result.stopSequence
      }
      if (isRecord(data.usage)) usage = { ...usage, ...data.usage }
    }
    if (type === 'message_stop') sawStop = true
  }
  for (const [idx, json] of partialJson) {
    const block = blocks[idx]
    if (block) { try { block.input = json === '' ? {} : JSON.parse(json) } catch { block.input = json } }
  }
  result.usageRaw = usage
  result.usage = usageOf(usage)
  result.stop = normalizeStop(result.stopReason)
  applyContent(result, blocks.filter(Boolean))
  result.stream = {
    events: labels,
    ttftMs: firstContentAt,
    totalMs: raw.latencyMs,
    generationMs: firstContentAt !== undefined && lastContentAt !== undefined ? lastContentAt - firstContentAt : undefined,
    sawDone: sawStop,
    chunkCount: events.length,
  }
  result.body = undefined
  return result
}
