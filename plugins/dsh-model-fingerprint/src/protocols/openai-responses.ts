/** OpenAI Responses (`openai-responses`). The Responses API has no `stop` parameter and needs max_output_tokens >= 16. */
import type { RawResponse } from '../http.ts'
import type { GenerationResult, SignatureArtifact, ToolCallInfo } from '../types.ts'
import { asNumber, asString, isRecord } from '../util.ts'
import { emptyResult, failureResult, parseJsonData, type GenerateParams, type ProtocolAdapter } from './common.ts'

function usageOf(usage: unknown): GenerationResult['usage'] {
  if (!isRecord(usage)) return {}
  const details = isRecord(usage.output_tokens_details) ? usage.output_tokens_details : {}
  return {
    inputTokens: asNumber(usage.input_tokens),
    outputTokens: asNumber(usage.output_tokens),
    reasoningTokens: asNumber(details.reasoning_tokens),
  }
}

/** Fill a result from a complete `response` object. */
function applyResponseObject(result: GenerationResult, json: Record<string, unknown>): void {
  result.id = asString(json.id)
  result.object = asString(json.object)
  result.model = asString(json.model)
  result.usageRaw = json.usage
  result.usage = usageOf(json.usage)
  const status = asString(json.status)
  const incomplete = isRecord(json.incomplete_details) ? asString(json.incomplete_details.reason) : undefined
  result.stopReason = incomplete ? `${status}:${incomplete}` : status
  const output = Array.isArray(json.output) ? json.output.filter(isRecord) : []
  let text = ''
  const toolCalls: ToolCallInfo[] = []
  const signatures: SignatureArtifact[] = []
  for (const item of output) {
    const type = asString(item.type)
    if (type === 'message' && Array.isArray(item.content)) {
      for (const part of item.content.filter(isRecord)) if (asString(part.type) === 'output_text') text += asString(part.text) ?? ''
    } else if (type === 'function_call') {
      toolCalls.push({ id: asString(item.call_id), itemId: asString(item.id), name: asString(item.name), arguments: item.arguments })
    } else if (type === 'reasoning' && asString(item.encrypted_content)) {
      signatures.push({ kind: 'openai-encrypted-reasoning', value: asString(item.encrypted_content) as string, items: [item] })
    }
  }
  result.text = text
  result.toolCalls = toolCalls
  result.signatures = signatures
  if (status === 'incomplete') result.stop = incomplete === 'max_output_tokens' ? 'length' : incomplete === 'content_filter' ? 'filter' : 'other'
  else if (status === 'completed') result.stop = toolCalls.length > 0 ? 'tool' : 'stop'
  else result.stop = status === undefined ? 'unknown' : 'other'
}

export const openaiResponses: ProtocolAdapter = {
  protocol: 'openai-responses',
  minMaxTokens: 16,

  generatePath() { return 'responses' },

  buildBody(model: string, p: GenerateParams) {
    const input: unknown[] = p.nativeMessages ?? [
      ...p.system !== undefined ? [{ role: 'system', content: p.system }] : [],
      { role: 'user', content: p.user },
    ]
    const body: Record<string, unknown> = { model, input, max_output_tokens: Math.max(16, p.maxTokens), store: false }
    if (p.temperature !== undefined) body.temperature = p.temperature
    if (p.tools !== undefined) {
      body.tools = p.tools.map(t => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters }))
      if (p.toolChoice !== undefined) body.tool_choice = p.toolChoice === 'auto' ? 'auto' : { type: 'function', name: p.toolChoice.name }
    }
    if (p.reasoningEffort !== undefined || p.thinking !== undefined) body.reasoning = { effort: p.reasoningEffort ?? 'low' }
    if (p.includeEncryptedReasoning) body.include = ['reasoning.encrypted_content']
    if (p.stream) body.stream = true
    return { ...body, ...p.extra }
  },

  parse(raw: RawResponse): GenerationResult {
    const failed = failureResult(raw)
    if (failed) return failed
    const result = emptyResult(raw)
    if (raw.events) return parseStream(raw, result)
    if (!isRecord(raw.json)) { result.ok = false; result.error = { message: 'response is not a JSON object' }; return result }
    applyResponseObject(result, raw.json)
    return result
  },
}

function parseStream(raw: RawResponse, result: GenerationResult): GenerationResult {
  const events = raw.events ?? []
  const labels: string[] = []
  let firstContentAt: number | undefined
  let lastContentAt: number | undefined
  let streamedText = ''
  let completed: Record<string, unknown> | undefined
  for (const ev of events) {
    const data = parseJsonData(ev.data)
    const type = ev.event ?? (isRecord(data) ? asString(data.type) : undefined) ?? 'message'
    labels.push(type)
    if (!isRecord(data)) continue
    if (type === 'error' || isRecord(data.error)) {
      result.ok = false
      const err = isRecord(data.error) ? data.error : data
      result.error = { message: asString(err.message), code: asString(err.code), type: asString(err.type) }
    }
    if (type === 'response.output_text.delta' || type === 'response.reasoning_summary_text.delta' || type === 'response.function_call_arguments.delta') {
      firstContentAt ??= ev.at
      lastContentAt = ev.at
      if (type === 'response.output_text.delta') streamedText += asString(data.delta) ?? ''
    }
    if ((type === 'response.completed' || type === 'response.incomplete' || type === 'response.failed') && isRecord(data.response)) completed = data.response
  }
  if (completed) applyResponseObject(result, completed)
  if (result.text === '') result.text = streamedText
  result.stream = {
    events: labels,
    ttftMs: firstContentAt,
    totalMs: raw.latencyMs,
    generationMs: firstContentAt !== undefined && lastContentAt !== undefined ? lastContentAt - firstContentAt : undefined,
    sawDone: completed !== undefined,
    chunkCount: events.length,
  }
  result.body = undefined
  return result
}
