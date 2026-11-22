/**
 * Response samples. "genuine" samples follow the shapes the official APIs
 * return (ids, envelopes, usage objects, stream event order); "forged"
 * samples are what format-converting relays / substitute models typically
 * emit. Values are illustrative, structure is what the probes check.
 */
import type { RawResponse } from '../src/http.ts'
import { SseParser, type SseEvent } from '../src/sse.ts'

export function jsonResponse(json: unknown, headers: Record<string, string> = {}, status = 200): RawResponse {
  return { ok: status >= 200 && status < 300, status, headers: new Headers({ 'content-type': 'application/json', ...headers }), json, text: JSON.stringify(json), latencyMs: 120, attempts: 1 }
}

export function sseResponse(text: string, headers: Record<string, string> = {}): RawResponse {
  const events: SseEvent[] = []
  let t = 100
  const parser = new SseParser(e => { events.push({ ...e, at: t }); t += 10 })
  parser.push(text)
  parser.end()
  return { ok: true, status: 200, headers: new Headers({ 'content-type': 'text/event-stream', ...headers }), events, latencyMs: t + 20, attempts: 1 }
}

export const ANTHROPIC_GENUINE = {
  id: 'msg_01XFDUDYJgAACzvnptvVoYEL', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5-20250929',
  content: [{ type: 'text', text: 'Hello! How can I help you today?' }],
  stop_reason: 'end_turn', stop_sequence: null,
  usage: { input_tokens: 12, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 }, output_tokens: 12, service_tier: 'standard' },
}
export const ANTHROPIC_GENUINE_HEADERS = { 'request-id': 'req_011CVabcdefGHIJKLmnopqrs', 'anthropic-ratelimit-requests-limit': '4000', 'anthropic-organization-id': '3f9c1b2a-0000-4000-8000-1234567890ab' }

export const ANTHROPIC_FORGED = {
  id: 'chatcmpl-9x8y7z', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5',
  content: [{ type: 'text', text: 'Hello!' }], stop_reason: 'stop', usage: { input_tokens: 12, output_tokens: 3 },
}

export const ANTHROPIC_STREAM_GENUINE = [
  'event: message_start',
  'data: {"type":"message_start","message":{"id":"msg_01ABCdefGHIjklMNOpqrSTUv","type":"message","role":"assistant","model":"claude-sonnet-4-5-20250929","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":12,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":1}}}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  '',
  'event: ping',
  'data: {"type": "ping"}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" there!"}}',
  '',
  'event: content_block_stop',
  'data: {"type":"content_block_stop","index":0}',
  '',
  'event: message_delta',
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":4}}',
  '',
  'event: message_stop',
  'data: {"type":"message_stop"}',
  '',
].join('\n')

export const ANTHROPIC_STREAM_FORGED = [
  'data: {"type":"message_start","message":{"id":"msg_1732270000","type":"message","role":"assistant","model":"claude-sonnet-4-5","content":[],"usage":{"input_tokens":12,"output_tokens":0}}}',
  '',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
  '',
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}',
  '',
].join('\n')

export const ANTHROPIC_THINKING_TOOL = {
  id: 'msg_01Aq9w938a90dw8q', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5-20250929',
  content: [
    { type: 'thinking', thinking: 'The user wants the weather in Paris; call get_weather.', signature: 'EqQBCgIYAhIM1gbcDa9GJwZA2b3hGgxBdjrkzLoky3dl1pkiMOYds5BZ2MlWBz6IpJkUdkOzhBYJGEjpCjSjbjuEdeA4ZRXYnRKxSmrDe1l6CRQyIUHo' },
    { type: 'tool_use', id: 'toolu_01A09q90qw90lq917835lq9', name: 'get_weather', input: { city: 'Paris' } },
  ],
  stop_reason: 'tool_use', stop_sequence: null,
  usage: { input_tokens: 420, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 85 },
}

export const CHAT_GENUINE = {
  id: 'chatcmpl-B9MBs8CjcvOU2jLn4n570S5qMJKcT', object: 'chat.completion', created: 1741569952, model: 'gpt-4o-2024-08-06',
  choices: [{ index: 0, message: { role: 'assistant', content: 'Hello! How can I assist you today?', refusal: null, annotations: [] }, logprobs: null, finish_reason: 'stop' }],
  usage: { prompt_tokens: 19, completion_tokens: 10, total_tokens: 29, prompt_tokens_details: { cached_tokens: 0, audio_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 0, audio_tokens: 0, accepted_prediction_tokens: 0, rejected_prediction_tokens: 0 } },
  service_tier: 'default', system_fingerprint: 'fp_fc9f1d7035',
}
export const CHAT_GENUINE_HEADERS = { 'x-request-id': 'req_0123456789abcdef0123456789abcdef', 'openai-processing-ms': '304', 'openai-version': '2020-10-01' }

export const CHAT_FORGED = {
  id: 'chatcmpl-6f1c2a3e-8b7d-4c1a-9e2f-0a1b2c3d4e5f', object: 'chat.completion', created: 1741569952, model: 'gpt-4o',
  choices: [{ index: 0, message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'eos' }],
  usage: { prompt_tokens: 20, completion_tokens: 3, total_tokens: 23 },
}

export const CHAT_TOOL_GENUINE = {
  ...CHAT_GENUINE,
  choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_abc123XYZ456def789ghi012', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Paris"}' } }] }, finish_reason: 'stop' }],
}

export const CHAT_STREAM_GENUINE = [
  'data: {"id":"chatcmpl-B9MBs8CjcvOU2jLn4n570S5qMJKcT","object":"chat.completion.chunk","created":1,"model":"gpt-4o-2024-08-06","system_fingerprint":"fp_fc9f1d7035","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}',
  '',
  'data: {"id":"chatcmpl-B9MBs8CjcvOU2jLn4n570S5qMJKcT","object":"chat.completion.chunk","created":1,"model":"gpt-4o-2024-08-06","system_fingerprint":"fp_fc9f1d7035","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}',
  '',
  'data: {"id":"chatcmpl-B9MBs8CjcvOU2jLn4n570S5qMJKcT","object":"chat.completion.chunk","created":1,"model":"gpt-4o-2024-08-06","system_fingerprint":"fp_fc9f1d7035","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
  '',
  'data: {"id":"chatcmpl-B9MBs8CjcvOU2jLn4n570S5qMJKcT","object":"chat.completion.chunk","created":1,"model":"gpt-4o-2024-08-06","system_fingerprint":"fp_fc9f1d7035","choices":[],"usage":{"prompt_tokens":19,"completion_tokens":2,"total_tokens":21}}',
  '',
  'data: [DONE]',
  '',
].join('\n')

export const CHAT_STREAM_FORGED = [
  'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}',
  '',
  'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
  '',
].join('\n')

export const RESPONSES_GENUINE = {
  id: 'resp_67ccd2bed1ec8190b14f964abc0542670bb6a6b452d3795b', object: 'response', created_at: 1741476542, status: 'completed', error: null, incomplete_details: null,
  model: 'gpt-4.1-2025-04-14',
  output: [{ type: 'message', id: 'msg_67ccd2bf17f0819081ff3bb2cf6508e60bb6a6b452d3795b', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: 'Hi there!', annotations: [] }] }],
  usage: { input_tokens: 36, input_tokens_details: { cached_tokens: 0 }, output_tokens: 4, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 40 },
}

export const RESPONSES_REASONING = {
  ...RESPONSES_GENUINE,
  model: 'o4-mini-2025-04-16',
  output: [
    { type: 'reasoning', id: 'rs_6820f383d7c08191846711c5df8233bc0ac5ba57aafcbac7', summary: [], encrypted_content: 'gAAAAABoIPOE3y8eCSnjd6uUtHPsj6TUVyR_fN0gU9OSZBnuqPJVdmJz7Iv9ZRvXWJIWOJt6aOjTM9l_8yKZzXUU0Zw-1LuHYYw' },
    { type: 'message', id: 'msg_6820f3', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: '391', annotations: [] }] },
  ],
}

export const RESPONSES_FORGED = {
  id: 'resp-0a1b2c3d', object: 'response', status: 'completed', model: 'gpt-4.1',
  output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hi' }] }],
  usage: { input_tokens: 36, output_tokens: 2, total_tokens: 38 },
}

export const RESPONSES_STREAM_GENUINE = [
  'event: response.created',
  'data: {"type":"response.created","sequence_number":0,"response":{"id":"resp_67ccd2bed1ec8190b14f964abc0542670bb6a6b452d3795b","object":"response","status":"in_progress","output":[]}}',
  '',
  'event: response.in_progress',
  'data: {"type":"response.in_progress","sequence_number":1,"response":{"id":"resp_67ccd2bed1ec8190b14f964abc0542670bb6a6b452d3795b","object":"response","status":"in_progress","output":[]}}',
  '',
  'event: response.output_text.delta',
  'data: {"type":"response.output_text.delta","sequence_number":2,"output_index":0,"content_index":0,"delta":"Hi"}',
  '',
  'event: response.output_text.delta',
  'data: {"type":"response.output_text.delta","sequence_number":3,"output_index":0,"content_index":0,"delta":" there!"}',
  '',
  `event: response.completed`,
  `data: ${JSON.stringify({ type: 'response.completed', sequence_number: 4, response: RESPONSES_GENUINE })}`,
  '',
].join('\n')

export const GEMINI_GENUINE = {
  candidates: [{ content: { parts: [{ text: 'Hello! How can I help?' }], role: 'model' }, finishReason: 'STOP', avgLogprobs: -0.0123, index: 0 }],
  usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 8, totalTokenCount: 13, promptTokensDetails: [{ modality: 'TEXT', tokenCount: 5 }], candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 8 }] },
  modelVersion: 'gemini-2.0-flash', responseId: 'mGLIZ5rQOMXZz7IPpKSEyAo',
}

export const GEMINI_FORGED = {
  candidates: [{ content: { parts: [{ text: 'Hello' }], role: 'model' }, finishReason: 'stop' }],
  usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
}

export const GEMINI_TOOL_SIGNED = {
  candidates: [{ content: { parts: [{ functionCall: { name: 'get_weather', args: { city: 'Paris' } }, thoughtSignature: 'CiwBVKhc7oTbF1Ffm6fw8m1yAWWQbK7aKuaJjnBqJmcnYXN0dXJlZC10aG91Z2h0cw==' }], role: 'model' }, finishReason: 'STOP', index: 0 }],
  usageMetadata: { promptTokenCount: 60, candidatesTokenCount: 12, thoughtsTokenCount: 40, totalTokenCount: 112 },
  modelVersion: 'gemini-2.5-flash', responseId: 'abcDEF123',
}

export const GEMINI_STREAM_GENUINE = [
  'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}],"role":"model"},"index":0}],"modelVersion":"gemini-2.0-flash","responseId":"mGLIZ5rQOMXZz7IPpKSEyAo"}',
  '',
  'data: {"candidates":[{"content":{"parts":[{"text":" there"}],"role":"model"},"finishReason":"STOP","index":0}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":3,"totalTokenCount":8},"modelVersion":"gemini-2.0-flash","responseId":"mGLIZ5rQOMXZz7IPpKSEyAo"}',
  '',
].join('\r\n')
