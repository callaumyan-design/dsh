import { describe, expect, it } from 'vitest'
import { adapterFor } from '../src/protocols/index.ts'
import { anthropicRoot } from '../src/protocols/anthropic.ts'
import { compareShapes, headerEvidence, modelEchoEvidence, nativeChecks, shapeOf } from '../src/probes/protocol.ts'
import * as F from './fixtures.ts'

const anthropic = adapterFor('anthropic-messages')
const chat = adapterFor('openai-completions')
const responses = adapterFor('openai-responses')
const gemini = adapterFor('google-generative-ai')

function coreFailures(checks: ReturnType<typeof nativeChecks>): string[] {
  return checks.filter(c => c.core && c.pass === false).map(c => c.name)
}

describe('Anthropic Messages', () => {
  it('parses a genuine response', () => {
    const r = anthropic.parse(F.jsonResponse(F.ANTHROPIC_GENUINE, F.ANTHROPIC_GENUINE_HEADERS))
    expect(r).toMatchObject({ ok: true, id: F.ANTHROPIC_GENUINE.id, object: 'message', stop: 'stop', stopReason: 'end_turn', usage: { inputTokens: 12, outputTokens: 12 } })
    expect(r.headers['request-id']).toBe('req_ + [0-9A-Za-z]{24}')
    expect(r.headers['anthropic-organization-id']).toBe('uuid')
  })

  it('parses a genuine stream and passes every native check', () => {
    const ns = anthropic.parse(F.jsonResponse(F.ANTHROPIC_GENUINE))
    const st = anthropic.parse(F.sseResponse(F.ANTHROPIC_STREAM_GENUINE))
    expect(st.text).toBe('Hello there!')
    expect(st.usage).toEqual({ inputTokens: 12, outputTokens: 4 })
    expect(st.stream?.sawDone).toBe(true)
    expect(st.stream?.ttftMs).toBeGreaterThan(0)
    expect(coreFailures(nativeChecks('anthropic', 'anthropic-messages', ns, st))).toEqual([])
  })

  it('flags a forged (converted) response', () => {
    const ns = anthropic.parse(F.jsonResponse(F.ANTHROPIC_FORGED))
    const st = anthropic.parse(F.sseResponse(F.ANTHROPIC_STREAM_FORGED))
    expect(coreFailures(nativeChecks('anthropic', 'anthropic-messages', ns, st))).toEqual(expect.arrayContaining(['id_prefix', 'stop_reason_enum', 'usage_keys', 'stream_sequence']))
  })

  it('extracts thinking signatures and tool_use', () => {
    const r = anthropic.parse(F.jsonResponse(F.ANTHROPIC_THINKING_TOOL))
    expect(r.stop).toBe('tool')
    expect(r.toolCalls[0]).toMatchObject({ id: 'toolu_01A09q90qw90lq917835lq9', name: 'get_weather', arguments: { city: 'Paris' } })
    expect(r.signatures[0]?.kind).toBe('anthropic-thinking')
    expect(r.signatures[0]?.items).toHaveLength(2)
  })

  it('builds requests and strips a trailing /v1 from the base', () => {
    expect(anthropicRoot('https://api.deepseek.com/anthropic/v1/')).toBe('https://api.deepseek.com/anthropic')
    const body = anthropic.buildBody('claude-x', { user: 'hi', system: 'sys', maxTokens: 17, stop: ['g'], temperature: 0, thinking: { budgetTokens: 1024 } }, {})
    expect(body).toMatchObject({ model: 'claude-x', max_tokens: 17, system: 'sys', stop_sequences: ['g'], temperature: 0, thinking: { type: 'enabled', budget_tokens: 1024 } })
  })

  it('surfaces provider errors', () => {
    const r = anthropic.parse(F.jsonResponse({ type: 'error', error: { type: 'invalid_request_error', message: 'bad' } }, {}, 400))
    expect(r.ok).toBe(false)
    expect(r.error).toMatchObject({ type: 'invalid_request_error', message: 'bad' })
  })
})

describe('OpenAI Chat Completions', () => {
  it('parses genuine non-stream + stream and passes native checks', () => {
    const ns = chat.parse(F.jsonResponse(F.CHAT_GENUINE, F.CHAT_GENUINE_HEADERS))
    const st = chat.parse(F.sseResponse(F.CHAT_STREAM_GENUINE))
    expect(ns).toMatchObject({ id: F.CHAT_GENUINE.id, systemFingerprint: 'fp_fc9f1d7035', stop: 'stop', usage: { inputTokens: 19, outputTokens: 10, reasoningTokens: 0 } })
    expect(ns.headers['x-request-id']).toBe('req_ + [0-9a-f]{32}')
    expect(st.text).toBe('Hello')
    expect(st.stream?.events.at(-1)).toBe('[DONE]')
    expect(coreFailures(nativeChecks('openai', 'openai-completions', ns, st))).toEqual([])
  })

  it('flags a forged response', () => {
    const ns = chat.parse(F.jsonResponse(F.CHAT_FORGED))
    const st = chat.parse(F.sseResponse(F.CHAT_STREAM_FORGED))
    expect(coreFailures(nativeChecks('openai', 'openai-completions', ns, st))).toEqual(expect.arrayContaining(['id_prefix', 'finish_reason_enum', 'usage_keys', 'stream_sequence']))
  })

  it('parses tool calls and uses the configured max-tokens field', () => {
    const r = chat.parse(F.jsonResponse(F.CHAT_TOOL_GENUINE))
    expect(r.toolCalls[0]).toMatchObject({ id: 'call_abc123XYZ456def789ghi012', name: 'get_weather', arguments: '{"city":"Paris"}' })
    expect(chat.buildBody('gpt-5', { user: 'x', maxTokens: 5 }, { maxTokensField: 'max_completion_tokens' })).toHaveProperty('max_completion_tokens', 5)
    expect(chat.buildBody('gpt-4o', { user: 'x', maxTokens: 5, stream: true, topLogprobs: 2 }, {})).toMatchObject({ max_tokens: 5, stream: true, stream_options: { include_usage: true }, logprobs: true, top_logprobs: 2 })
  })
})

describe('OpenAI Responses', () => {
  it('parses genuine response + stream and passes native checks', () => {
    const ns = responses.parse(F.jsonResponse(F.RESPONSES_GENUINE))
    const st = responses.parse(F.sseResponse(F.RESPONSES_STREAM_GENUINE))
    expect(ns).toMatchObject({ object: 'response', text: 'Hi there!', stop: 'stop', usage: { inputTokens: 36, outputTokens: 4 } })
    expect(st.text).toBe('Hi there!')
    expect(coreFailures(nativeChecks('openai', 'openai-responses', ns, st))).toEqual([])
  })

  it('extracts encrypted reasoning', () => {
    const r = responses.parse(F.jsonResponse(F.RESPONSES_REASONING))
    expect(r.signatures[0]).toMatchObject({ kind: 'openai-encrypted-reasoning' })
    expect(r.text).toBe('391')
  })

  it('flags a forged response and enforces the 16-token minimum', () => {
    const ns = responses.parse(F.jsonResponse(F.RESPONSES_FORGED))
    expect(coreFailures(nativeChecks('openai', 'openai-responses', ns, undefined))).toEqual(expect.arrayContaining(['id_prefix', 'usage_keys']))
    expect(responses.buildBody('o3', { user: 'x', maxTokens: 1 }, {})).toMatchObject({ max_output_tokens: 16, store: false })
    expect(responses.minMaxTokens).toBe(16)
  })

  it('maps incomplete max_output_tokens to length', () => {
    const r = responses.parse(F.jsonResponse({ ...F.RESPONSES_GENUINE, status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }))
    expect(r.stop).toBe('length')
  })
})

describe('Gemini', () => {
  it('parses genuine response + CRLF stream and passes native checks', () => {
    const ns = gemini.parse(F.jsonResponse(F.GEMINI_GENUINE, { server: 'scaffolding on HTTPServer2' }))
    const st = gemini.parse(F.sseResponse(F.GEMINI_STREAM_GENUINE))
    expect(ns).toMatchObject({ id: 'mGLIZ5rQOMXZz7IPpKSEyAo', model: 'gemini-2.0-flash', stop: 'stop', usage: { inputTokens: 5, outputTokens: 8 } })
    expect(ns.headers.server).toBe('known:scaffolding on httpserver2')
    expect(st.text).toBe('Hello there')
    expect(st.usage.outputTokens).toBe(3)
    expect(coreFailures(nativeChecks('google', 'google-generative-ai', ns, st))).toEqual([])
  })

  it('flags a forged response', () => {
    const ns = gemini.parse(F.jsonResponse(F.GEMINI_FORGED))
    expect(coreFailures(nativeChecks('google', 'google-generative-ai', ns, undefined))).toEqual(expect.arrayContaining(['response_id', 'model_version', 'finish_reason_enum', 'usage_keys']))
  })

  it('extracts thought signatures and counts thinking tokens as output', () => {
    const r = gemini.parse(F.jsonResponse(F.GEMINI_TOOL_SIGNED))
    expect(r.signatures[0]?.kind).toBe('gemini-thought-signature')
    expect(r.usage).toEqual({ inputTokens: 60, outputTokens: 52, reasoningTokens: 40 })
    expect(r.stop).toBe('tool')
    expect(gemini.generatePath('gemini-2.5-flash', true)).toBe('models/gemini-2.5-flash:streamGenerateContent?alt=sse')
    expect(gemini.countTokensPath!('models/gemini-2.5-flash')).toBe('models/gemini-2.5-flash:countTokens')
  })
})

describe('shape comparison and header/echo evidence', () => {
  it('identical shapes match, converted shapes differ', () => {
    const a = shapeOf('openai-completions', chat.parse(F.jsonResponse(F.CHAT_GENUINE)), chat.parse(F.sseResponse(F.CHAT_STREAM_GENUINE)))
    const b = shapeOf('openai-completions', chat.parse(F.jsonResponse({ ...F.CHAT_GENUINE, id: 'chatcmpl-Zz9MBs8CjcvOU2jLn4n570S5qMJKc' })), chat.parse(F.sseResponse(F.CHAT_STREAM_GENUINE)))
    const c = shapeOf('openai-completions', chat.parse(F.jsonResponse(F.CHAT_FORGED)), chat.parse(F.sseResponse(F.CHAT_STREAM_FORGED)))
    expect(compareShapes(a, b).differ).toEqual([])
    expect(compareShapes(a, c).differ.length).toBeGreaterThanOrEqual(2)
  })

  it('headers: own vendor weak match, foreign vendor weak mismatch', () => {
    expect(headerEvidence('openai', { 'openai-processing-ms': 'integer(3 digits)' })).toMatchObject({ strength: 'weak', result: 'match' })
    expect(headerEvidence('anthropic', { 'openai-processing-ms': 'integer(3 digits)' })).toMatchObject({ strength: 'weak', result: 'mismatch' })
    expect(headerEvidence('anthropic', {})).toMatchObject({ result: 'inconclusive' })
  })

  it('model echo of another vendor is a medium mismatch', () => {
    expect(modelEchoEvidence('gpt-4o', 'deepseek-chat')).toMatchObject({ strength: 'medium', result: 'mismatch' })
    expect(modelEchoEvidence('gpt-4o', 'gpt-4o-2024-08-06')).toMatchObject({ strength: 'weak', result: 'match' })
    expect(modelEchoEvidence('claude-sonnet-4-5', 'qwen-max')).toMatchObject({ result: 'mismatch' })
  })
})
