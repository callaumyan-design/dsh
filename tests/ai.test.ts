import { describe, expect, it } from 'vitest'
import { isOfficialAnthropic, streamAnthropic, supportsServerFallback, toAnthropicMessages } from '../src/core/ai/anthropic'
import { extractJson } from '../src/core/ai/client'
import { EmotionStreamParser, stripEmotionTags } from '../src/core/ai/emotion'
import { embedOpenAI, streamOpenAI } from '../src/core/ai/openai'
import { buildChatMessages, buildSystemPrompt } from '../src/core/ai/prompt'
import type { ProviderConfig } from '../src/core/ai/types'
import { createGame } from '../src/core/game/engine'
import { DEFAULT_PERSONA } from '../src/core/persona/persona'

function sseResponse(events: string[], contentType = 'text/event-stream'): Response {
  const enc = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      // split events across odd chunk boundaries to exercise the parser
      const all = events.join('')
      for (let i = 0; i < all.length; i += 7) c.enqueue(enc.encode(all.slice(i, i + 7)))
      c.close()
    }
  })
  return new Response(body, { status: 200, headers: { 'content-type': contentType } })
}

const openaiCfg: ProviderConfig = { id: 'x', name: 'x', kind: 'openai', baseURL: 'https://api.example.com/v1/', model: 'm' }

describe('emotion tags', () => {
  it('strips known tags and keeps unknown brackets', () => {
    expect(stripEmotionTags('[happy] 你好呀')).toEqual({ text: '你好呀', emotion: 'happy' })
    expect(stripEmotionTags('【开心】好耶')).toEqual({ text: '好耶', emotion: 'happy' })
    expect(stripEmotionTags('看这个[链接]')).toEqual({ text: '看这个[链接]', emotion: null })
  })

  it('handles tags split across stream chunks', () => {
    const p = new EmotionStreamParser()
    let out = ''
    for (const d of ['[ha', 'ppy', ']', ' 你好', '，今天[', 'sad]也', '要加油']) out += p.push(d).text
    out += p.flush().text
    expect(out).toBe('你好，今天也要加油')
    expect(p.emotion).toBe('happy')
  })

  it('does not hold back text forever on an unclosed bracket', () => {
    const p = new EmotionStreamParser()
    let out = p.push('数组 a[0').text
    out += p.push(' 是第一个元素，很长很长的一句话').text
    out += p.flush().text
    expect(out).toBe('数组 a[0 是第一个元素，很长很长的一句话')
  })
})

describe('openai-compatible client', () => {
  it('streams deltas and reads usage', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fakeFetch = async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return sseResponse([
        'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"[happy]你"}}]}\n\n',
        ': keep-alive\n\n',
        'data: {"choices":[{"delta":{"content":"好"},"finish_reason":"stop"}]}\n\n',
        'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":3}}\n\n',
        'data: [DONE]\n\n'
      ])
    }
    const deltas: string[] = []
    const r = await streamOpenAI(openaiCfg, [{ role: 'user', content: 'hi' }], { apiKey: 'sk-1', fetch: fakeFetch, onDelta: (d) => deltas.push(d) })
    expect(r.text).toBe('[happy]你好')
    expect(deltas.join('')).toBe('[happy]你好')
    expect(r.usage).toEqual({ inputTokens: 12, outputTokens: 3 })
    expect(r.stopReason).toBe('stop')
    expect(calls[0].url).toBe('https://api.example.com/v1/chat/completions')
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer sk-1')
    expect(JSON.parse(String(calls[0].init?.body)).stream).toBe(true)
  })

  it('maps HTTP errors to friendly messages', async () => {
    const fakeFetch = async () => new Response(JSON.stringify({ error: { message: 'Authentication Fails' } }), { status: 401 })
    await expect(streamOpenAI(openaiCfg, [], { apiKey: 'bad', fetch: fakeFetch })).rejects.toThrow(/API Key 无效/)
    const poor = async () => new Response('{"error":{"message":"Insufficient Balance"}}', { status: 402 })
    await expect(streamOpenAI(openaiCfg, [], { apiKey: 'k', fetch: poor })).rejects.toThrow(/余额不足/)
  })

  it('accepts non-streaming JSON replies and estimates usage when absent', async () => {
    const fakeFetch = async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '好的' }, finish_reason: 'stop' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    const r = await streamOpenAI(openaiCfg, [{ role: 'user', content: '你好' }], { apiKey: '', fetch: fakeFetch })
    expect(r.text).toBe('好的')
    expect(r.usage.estimated).toBe(true)
  })

  it('embeddings keep input order', async () => {
    const fakeFetch = async () =>
      new Response(JSON.stringify({ data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }] }), { status: 200 })
    expect(await embedOpenAI({ baseURL: 'https://e.example/v1', model: 'e' }, ['a', 'b'], 'k', fakeFetch)).toEqual([
      [1, 0],
      [0, 1]
    ])
  })
})

describe('anthropic client (official SDK, fetch injected)', () => {
  const cfg: ProviderConfig = { id: 'a', name: 'Claude', kind: 'anthropic', baseURL: 'https://api.anthropic.com', model: 'claude-opus-5-5', effort: 'low', useFallbacks: true }

  const anthropicEvents = (stop = 'end_turn') => [
    'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-opus-5-5","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":20,"output_tokens":1}}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"[love]想你"}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"啦"}}\n\n',
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
    `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"${stop}","stop_sequence":null},"usage":{"output_tokens":9}}\n\n`,
    'event: message_stop\ndata: {"type":"message_stop"}\n\n'
  ]

  it('streams text, reports usage, and sends effort + fallbacks', async () => {
    let sent: any
    let headers: Headers | undefined
    let url = ''
    const fakeFetch = async (u: string, init?: RequestInit) => {
      url = String(u)
      sent = JSON.parse(String(init?.body))
      headers = new Headers(init?.headers)
      return sseResponse(anthropicEvents())
    }
    const deltas: string[] = []
    const r = await streamAnthropic(
      cfg,
      [
        { role: 'system', content: '你是团子' },
        { role: 'assistant', content: '你好呀' },
        { role: 'user', content: '在吗' }
      ],
      { apiKey: 'sk-ant-test', fetch: fakeFetch, onDelta: (d) => deltas.push(d) }
    )
    expect(r.text).toBe('[love]想你啦')
    expect(deltas.join('')).toBe('[love]想你啦')
    expect(r.usage).toEqual({ inputTokens: 20, outputTokens: 9 })
    expect(url).toContain('/v1/messages')
    expect(sent.system).toBe('你是团子')
    expect(sent.messages[0].role).toBe('user')
    expect(sent.output_config).toEqual({ effort: 'low' })
    expect(sent.fallbacks).toBe('default')
    expect(sent.temperature).toBeUndefined()
    expect(headers?.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01')
    expect(headers?.get('authorization') ?? headers?.get('x-api-key')).toContain('sk-ant-test')
  })

  it('treats a refusal stop reason as an error', async () => {
    const fakeFetch = async () => sseResponse(anthropicEvents('refusal'))
    await expect(streamAnthropic(cfg, [{ role: 'user', content: 'x' }], { apiKey: 'k', fetch: fakeFetch })).rejects.toThrow(/refusal/)
  })

  it('skips fallbacks for proxies and unsupported models', () => {
    expect(isOfficialAnthropic('https://api.anthropic.com')).toBe(true)
    expect(isOfficialAnthropic('https://my-proxy.example.com')).toBe(false)
    expect(supportsServerFallback('claude-opus-5-5')).toBe(true)
    expect(supportsServerFallback('claude-sonnet-5-5')).toBe(true)
    expect(supportsServerFallback('claude-haiku-5-5')).toBe(false)
  })

  it('merges consecutive roles', () => {
    const r = toAnthropicMessages([
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
      { role: 'assistant', content: 'c' }
    ])
    expect(r.messages).toEqual([
      { role: 'user', content: 'a\n\nb' },
      { role: 'assistant', content: 'c' }
    ])
  })
})

describe('prompt', () => {
  it('includes persona, state and memories; history is trimmed oldest-first', () => {
    const sys = buildSystemPrompt({
      persona: DEFAULT_PERSONA,
      game: createGame(Date.now()),
      coreMemories: [{ id: '1', text: '用户叫小明', updatedAt: Date.now() } as never],
      relevantMemories: [],
      now: new Date(2026, 10, 3, 21, 30)
    })
    expect(sys).toContain('团子')
    expect(sys).toContain('用户叫小明')
    expect(sys).toContain('[happy]')
    expect(sys).toContain('晚上 21:30')

    const history = Array.from({ length: 30 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: `第${i}条`.padEnd(100, '。') }))
    const msgs = buildChatMessages(sys, history, '现在', 1000)
    expect(msgs[0].role).toBe('system')
    expect(msgs[1].role).toBe('user')
    expect(msgs.at(-1)).toEqual({ role: 'user', content: '现在' })
    expect(msgs.length).toBeLessThan(15)
  })

  it('extractJson tolerates chatter', () => {
    expect(extractJson('sure! {"a":1} done')).toEqual({ a: 1 })
    expect(extractJson('nothing')).toBeNull()
  })
})
