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
