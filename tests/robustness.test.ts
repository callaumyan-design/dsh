import { describe, expect, it } from 'vitest'
import { streamOpenAI } from '../src/core/ai/openai'
import type { ProviderConfig } from '../src/core/ai/types'
import { redact } from '../src/main/logger'

const cfg: ProviderConfig = { id: 'x', name: 'x', kind: 'openai', baseURL: 'https://api.example.com/v1', model: 'm' }

describe('json mode', () => {
  it('sends response_format and retries without it when the provider rejects it', async () => {
    const bodies: any[] = []
    const fakeFetch = async (_u: string, init?: RequestInit) => {
      const b = JSON.parse(String(init?.body))
      bodies.push(b)
      if (b.response_format) return new Response('{"error":{"message":"response_format not supported"}}', { status: 400 })
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ops":[]}' } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const r = await streamOpenAI(cfg, [{ role: 'user', content: 'json please' }], { apiKey: 'k', fetch: fakeFetch, json: true })
    expect(r.text).toBe('{"ops":[]}')
    expect(bodies).toHaveLength(2)
    expect(bodies[0].response_format).toEqual({ type: 'json_object' })
    expect(bodies[1].response_format).toBeUndefined()
  })
})

describe('log redaction', () => {
  it('masks API keys and bearer tokens', () => {
    expect(redact('key sk-abcdefgh12345678901234 used')).toBe('key sk-abcdefgh… used')
    expect(redact('sk-ant-api03abcdefghijklmnop')).toBe('sk-ant-api03abc…')
    expect(redact('Authorization: Bearer abcdefghijklmnopqrstu')).toBe('Authorization: Bearer …')
    expect(redact('nothing secret here')).toBe('nothing secret here')
  })
})

describe('openai reasoning models', () => {
  it('uses max_completion_tokens with headroom for gpt-5 / o-series and swaps on a param error', async () => {
    const bodies: any[] = []
    const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
    const f = async (_u: string, init?: RequestInit) => (bodies.push(JSON.parse(String(init?.body))), ok())
    await streamOpenAI({ ...cfg, model: 'gpt-5-mini' }, [], { apiKey: 'k', fetch: f, maxTokens: 20 })
    expect(bodies[0].max_completion_tokens).toBe(4000)
    expect(bodies[0].max_tokens).toBeUndefined()

    const seen: any[] = []
    const g = async (_u: string, init?: RequestInit) => {
      const b = JSON.parse(String(init?.body))
      seen.push(b)
      if ('max_tokens' in b) return new Response(JSON.stringify({ error: { message: "Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead." } }), { status: 400 })
      return ok()
    }
    const r = await streamOpenAI({ ...cfg, model: 'my-proxy/some-reasoner' }, [], { apiKey: 'k', fetch: g, maxTokens: 800 })
    expect(r.text).toBe('hi')
    expect(seen[1].max_completion_tokens).toBe(4000)
  })
})
