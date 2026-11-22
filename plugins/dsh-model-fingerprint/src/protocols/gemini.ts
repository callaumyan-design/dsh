/** Gemini API (`google-generative-ai`). The base URL carries the API version, e.g. `https://…/v1beta`. */
import type { RawResponse } from '../http.ts'
import type { GenerationResult, SignatureArtifact, ToolCallInfo } from '../types.ts'
import { asNumber, asString, isRecord } from '../util.ts'
import { emptyResult, failureResult, parseJsonData, type GenerateParams, type ProtocolAdapter } from './common.ts'

const FILTER_REASONS = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY', 'LANGUAGE'])

function usageOf(usage: unknown): GenerationResult['usage'] {
  if (!isRecord(usage)) return {}
  const candidates = asNumber(usage.candidatesTokenCount)
  const thoughts = asNumber(usage.thoughtsTokenCount)
  return {
    inputTokens: asNumber(usage.promptTokenCount),
    outputTokens: candidates === undefined && thoughts === undefined ? undefined : (candidates ?? 0) + (thoughts ?? 0),
    reasoningTokens: thoughts,
  }
}

function modelPath(model: string): string {
  return `models/${encodeURIComponent(model.replace(/^models\//, ''))}`
}

interface Accum { text: string; toolCalls: ToolCallInfo[]; parts: Record<string, unknown>[]; finish?: string }

function accumulate(acc: Accum, json: Record<string, unknown>): void {
  const cand = Array.isArray(json.candidates) && isRecord(json.candidates[0]) ? json.candidates[0] : undefined
  if (!cand) return
  if (asString(cand.finishReason)) acc.finish = asString(cand.finishReason)
  const content = isRecord(cand.content) ? cand.content : undefined
  for (const part of (Array.isArray(content?.parts) ? content.parts : []).filter(isRecord)) {
    acc.parts.push(part)
    if (part.thought === true) continue
    if (asString(part.text)) acc.text += asString(part.text)
    if (isRecord(part.functionCall)) acc.toolCalls.push({ id: asString(part.functionCall.id), name: asString(part.functionCall.name), arguments: part.functionCall.args })
  }
}

function finish(result: GenerationResult, acc: Accum): void {
  result.text = acc.text
  result.toolCalls = acc.toolCalls
  result.stopReason = acc.finish
  if (acc.finish === 'STOP') result.stop = acc.toolCalls.length > 0 ? 'tool' : 'stop'
  else if (acc.finish === 'MAX_TOKENS') result.stop = 'length'
  else if (acc.finish !== undefined && FILTER_REASONS.has(acc.finish)) result.stop = 'filter'
  else result.stop = acc.finish === undefined ? 'unknown' : 'other'
  const signed = acc.parts.find(p => asString(p.thoughtSignature))
  if (signed) {
    const sig: SignatureArtifact = { kind: 'gemini-thought-signature', value: asString(signed.thoughtSignature) as string, items: acc.parts.filter(p => p.thought !== true || asString(p.thoughtSignature)) }
    result.signatures = [sig]
  }
}

export const gemini: ProtocolAdapter = {
  protocol: 'google-generative-ai',
  minMaxTokens: 1,

  generatePath(model: string, stream: boolean) {
    return stream ? `${modelPath(model)}:streamGenerateContent?alt=sse` : `${modelPath(model)}:generateContent`
  },

  buildBody(_model: string, p: GenerateParams) {
    const contents: unknown[] = p.nativeMessages ?? [{ role: 'user', parts: [{ text: p.user }] }]
    const generationConfig: Record<string, unknown> = { maxOutputTokens: p.maxTokens }
    if (p.temperature !== undefined) generationConfig.temperature = p.temperature
    if (p.stop !== undefined) generationConfig.stopSequences = p.stop
    if (p.topLogprobs !== undefined) { generationConfig.responseLogprobs = true; generationConfig.logprobs = p.topLogprobs }
    if (p.thinking !== undefined) generationConfig.thinkingConfig = { includeThoughts: false, thinkingBudget: p.thinking.budgetTokens }
    const body: Record<string, unknown> = { contents, generationConfig }
    if (p.system !== undefined) body.systemInstruction = { parts: [{ text: p.system }] }
    if (p.tools !== undefined) {
      body.tools = [{ functionDeclarations: p.tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })) }]
      if (p.toolChoice !== undefined) {
        body.toolConfig = p.toolChoice === 'auto'
          ? { functionCallingConfig: { mode: 'AUTO' } }
          : { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [p.toolChoice.name] } }
      }
    }
    return { ...body, ...p.extra }
  },

  parse(raw: RawResponse): GenerationResult {
    const failed = failureResult(raw)
    if (failed) return failed
    const result = emptyResult(raw)
    const acc: Accum = { text: '', toolCalls: [], parts: [] }
    if (raw.events) {
      const labels: string[] = []
      let firstContentAt: number | undefined
      let lastContentAt: number | undefined
      for (const ev of raw.events) {
        const json = parseJsonData(ev.data)
        if (!isRecord(json)) { labels.push('invalid'); continue }
        if (isRecord(json.error)) { result.ok = false; result.error = { message: asString(json.error.message), type: asString(json.error.status) }; labels.push('error'); continue }
        const before = acc.parts.length
        accumulate(acc, json)
        result.id ??= asString(json.responseId)
        result.model ??= asString(json.modelVersion)
        if (isRecord(json.usageMetadata)) { result.usageRaw = json.usageMetadata; result.usage = usageOf(json.usageMetadata) }
        const hasCandidates = Array.isArray(json.candidates)
        const chunkFinish = hasCandidates && isRecord((json.candidates as unknown[])[0]) && asString(((json.candidates as unknown[])[0] as Record<string, unknown>).finishReason) !== undefined
        labels.push(`chunk${hasCandidates ? ':candidates' : ''}${acc.parts.length > before ? ':parts' : ''}${isRecord(json.usageMetadata) ? ':usage' : ''}${chunkFinish ? ':finish' : ''}`)
        if (acc.parts.length > before) { firstContentAt ??= ev.at; lastContentAt = ev.at }
      }
      finish(result, acc)
      result.stream = {
        events: labels,
        ttftMs: firstContentAt,
        totalMs: raw.latencyMs,
        generationMs: firstContentAt !== undefined && lastContentAt !== undefined ? lastContentAt - firstContentAt : undefined,
        sawDone: acc.finish !== undefined,
        chunkCount: raw.events.length,
      }
      result.body = undefined
      return result
    }
    const json = raw.json
    if (!isRecord(json)) { result.ok = false; result.error = { message: 'response is not a JSON object' }; return result }
    result.id = asString(json.responseId)
    result.model = asString(json.modelVersion)
    result.usageRaw = json.usageMetadata
    result.usage = usageOf(json.usageMetadata)
    accumulate(acc, json)
    finish(result, acc)
    const cand = Array.isArray(json.candidates) && isRecord(json.candidates[0]) ? json.candidates[0] : undefined
    if (cand && isRecord(cand.logprobsResult) && Array.isArray(cand.logprobsResult.chosenCandidates)) {
      result.logprobs = cand.logprobsResult.chosenCandidates.filter(isRecord).map(c => ({ token: asString(c.token) ?? '', logprob: asNumber(c.logProbability) ?? Number.NaN }))
    }
    return result
  },

  countTokensPath(model: string) { return `${modelPath(model)}:countTokens` },

  countTokensBody(_model: string, p: GenerateParams) {
    // countTokens accepts `contents` (and systemInstruction only inside generateContentRequest).
    return { contents: p.nativeMessages ?? [{ role: 'user', parts: [{ text: p.user }] }] }
  },

  parseCountTokens(json: unknown) {
    return isRecord(json) ? asNumber(json.totalTokens) : undefined
  },
}
