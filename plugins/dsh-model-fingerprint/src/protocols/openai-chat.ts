/** OpenAI Chat Completions (`openai-completions`). */
import type { RawResponse } from '../http.ts'
import type { GenerationResult, ToolCallInfo } from '../types.ts'
import { asNumber, asString, isRecord } from '../util.ts'
import { emptyResult, failureResult, parseJsonData, type AdapterOptions, type GenerateParams, type ProtocolAdapter } from './common.ts'

function normalizeStop(reason: string | undefined): GenerationResult['stop'] {
  switch (reason) {
    case 'stop': return 'stop'
    case 'length': return 'length'
    case 'tool_calls':
    case 'function_call': return 'tool'
    case 'content_filter': return 'filter'
    case undefined: return 'unknown'
    default: return 'other'
  }
}

function usageOf(usage: unknown): GenerationResult['usage'] {
  if (!isRecord(usage)) return {}
  const details = isRecord(usage.completion_tokens_details) ? usage.completion_tokens_details : {}
  return {
    inputTokens: asNumber(usage.prompt_tokens),
    outputTokens: asNumber(usage.completion_tokens),
    reasoningTokens: asNumber(details.reasoning_tokens),
  }
}

export const openaiChat: ProtocolAdapter = {
  protocol: 'openai-completions',
  minMaxTokens: 1,

  generatePath() { return 'chat/completions' },

  buildBody(model: string, p: GenerateParams, options: AdapterOptions) {
    const messages: unknown[] = p.nativeMessages ?? [
      ...p.system !== undefined ? [{ role: 'system', content: p.system }] : [],
      { role: 'user', content: p.user },
    ]
    const body: Record<string, unknown> = { model, messages }
    body[options.maxTokensField ?? 'max_tokens'] = p.maxTokens
    if (p.temperature !== undefined) body.temperature = p.temperature
    if (p.stop !== undefined) body.stop = p.stop
    if (p.tools !== undefined) {
      body.tools = p.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }))
      if (p.toolChoice !== undefined) body.tool_choice = p.toolChoice === 'auto' ? 'auto' : { type: 'function', function: { name: p.toolChoice.name } }
    }
    if (p.topLogprobs !== undefined) { body.logprobs = true; body.top_logprobs = p.topLogprobs }
    if (p.reasoningEffort !== undefined) body.reasoning_effort = p.reasoningEffort
    if (p.stream) { body.stream = true; body.stream_options = { include_usage: true } }
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
    result.object = asString(json.object)
    result.model = asString(json.model)
    result.systemFingerprint = json.system_fingerprint === null ? null : asString(json.system_fingerprint)
    result.usageRaw = json.usage
    result.usage = usageOf(json.usage)
    const choice = Array.isArray(json.choices) && isRecord(json.choices[0]) ? json.choices[0] : undefined
    const message = choice && isRecord(choice.message) ? choice.message : undefined
    result.text = asString(message?.content) ?? ''
    result.stopReason = asString(choice?.finish_reason)
    result.stop = normalizeStop(result.stopReason)
    if (message && Array.isArray(message.tool_calls)) {
      result.toolCalls = message.tool_calls.filter(isRecord).map((c): ToolCallInfo => {
        const fn = isRecord(c.function) ? c.function : {}
        return { id: asString(c.id), name: asString(fn.name), arguments: fn.arguments }
      })
    }
    if (choice && 'logprobs' in choice) {
      const lp = choice.logprobs
      result.logprobs = isRecord(lp) && Array.isArray(lp.content)
        ? lp.content.filter(isRecord).map(t => ({ token: asString(t.token) ?? '', logprob: asNumber(t.logprob) ?? Number.NaN, bytes: Array.isArray(t.bytes) ? t.bytes as number[] : null }))
        : null
    }
    return result
  },
}

function parseStream(raw: RawResponse, result: GenerationResult): GenerationResult {
  const events = raw.events ?? []
  const labels: string[] = []
  const toolCalls = new Map<number, ToolCallInfo & { args: string }>()
  let firstContentAt: number | undefined
  let lastContentAt: number | undefined
  let sawDone = false
  for (const ev of events) {
    if (ev.data.trim() === '[DONE]') { sawDone = true; labels.push('[DONE]'); continue }
    const chunk = parseJsonData(ev.data)
    if (!isRecord(chunk)) { labels.push('invalid'); continue }
    if (isRecord(chunk.error)) { result.ok = false; result.error = { message: asString(chunk.error.message), type: asString(chunk.error.type) }; labels.push('error'); continue }
    result.id ??= asString(chunk.id)
    result.object ??= asString(chunk.object)
    result.model ??= asString(chunk.model)
    if (result.systemFingerprint === undefined && 'system_fingerprint' in chunk) result.systemFingerprint = chunk.system_fingerprint === null ? null : asString(chunk.system_fingerprint)
    if (isRecord(chunk.usage)) { result.usageRaw = chunk.usage; result.usage = usageOf(chunk.usage) }
    const choice = Array.isArray(chunk.choices) && isRecord(chunk.choices[0]) ? chunk.choices[0] : undefined
    const delta = choice && isRecord(choice.delta) ? choice.delta : undefined
    let label = asString(chunk.object) ?? 'chunk'
    if (delta) {
      if (asString(delta.role)) label += ':role'
      const content = asString(delta.content)
      const reasoning = asString(delta.reasoning_content) ?? asString(delta.reasoning)
      if (content) { result.text += content; label += ':content' }
      if (reasoning) label += ':reasoning'
      if (Array.isArray(delta.tool_calls)) {
        label += ':tool'
        for (const tc of delta.tool_calls.filter(isRecord)) {
          const idx = asNumber(tc.index) ?? 0
          const entry = toolCalls.get(idx) ?? { args: '' }
          entry.id ??= asString(tc.id)
          const fn = isRecord(tc.function) ? tc.function : {}
          entry.name ??= asString(fn.name)
          entry.args += asString(fn.arguments) ?? ''
          toolCalls.set(idx, entry)
        }
      }
      if (content || reasoning || Array.isArray(delta.tool_calls)) {
        firstContentAt ??= ev.at
        lastContentAt = ev.at
      }
    }
    if (choice && asString(choice.finish_reason)) { result.stopReason = asString(choice.finish_reason); label += ':finish' }
    if (isRecord(chunk.usage)) label += ':usage'
    labels.push(label)
  }
  result.stop = normalizeStop(result.stopReason)
  result.toolCalls = [...toolCalls.values()].map(({ args, ...rest }) => ({ ...rest, arguments: args }))
  result.stream = {
    events: labels,
    ttftMs: firstContentAt,
    totalMs: raw.latencyMs,
    generationMs: firstContentAt !== undefined && lastContentAt !== undefined ? lastContentAt - firstContentAt : undefined,
    sawDone,
    chunkCount: events.length,
  }
  result.body = undefined
  return result
}
