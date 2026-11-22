import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { maskSecret, Redactor, toJsonValue, truncateDeep } from '../src/redact.ts'
import { backoffMs, joinURL, OriginMismatchError, OriginTransport, parseRetryAfter } from '../src/http.ts'
import { BudgetExceededError, BudgetTracker, DEFAULT_BUDGET, estimate, exceeds } from '../src/budget.ts'
import { assertKeySeparation, isOfficialOrigin, resolveReference, resolveSecret, resolveTarget, routeFromPatchFiles, ResolveError } from '../src/resolve.ts'
import { describeFormat, idPattern, quantile, summarize } from '../src/util.ts'
import { SseParser } from '../src/sse.ts'

const services = (map: Record<string, unknown> = {}) => ({ get: (name: string) => map[name] })
const OPTS = { extraOfficialHosts: [] as string[], allowInsecureHttp: false }

describe('redaction', () => {
  it('masks known secrets and generic key shapes everywhere', () => {
    const r = new Redactor()
    r.add('relay-secret-value-1234567890')
    const out = r.redact({
      msg: 'bad key relay-secret-value-1234567890 and sk-ant-api03-abcdefghijklmnop and AIzaSyA1234567890abcdefghijklmnopq',
      headers: { authorization: 'Bearer sk-proj-abcdefghijklmnopqrstuv', 'x-api-key': 'k' },
      url: 'https://x.example/v1?key=AIzaSecretSecretSecret&b=1',
      nested: [{ apiKey: 'should-not-leak-1234567890' }],
    })
    const text = JSON.stringify(out)
    expect(text).not.toContain('relay-secret-value-1234567890')
    expect(text).not.toContain('sk-ant-api03-abcdefghijklmnop')
    expect(text).not.toContain('AIzaSyA1234567890abcdefghijklmnopq')
    expect(text).not.toContain('sk-proj-abcdefghijklmnopqrstuv')
    expect(text).not.toContain('AIzaSecretSecretSecret')
    expect(text).not.toContain('should-not-leak-1234567890')
    expect(maskSecret('short')).toBe('****')
    expect(maskSecret('abcdefghijklmnopqrstuvwxyz')).toBe('abcd…yz')
  })

  it('produces lossless JSON and truncates for the model view', () => {
    expect(toJsonValue({ a: Number.NaN, b: undefined, c: Infinity, d: [1, undefined] })).toEqual({ a: null, c: null, d: [1, null] })
    expect(truncateDeep({ s: 'x'.repeat(50) }, 10)).toEqual({ s: `${'x'.repeat(10)}…[+40 chars]` })
  })
})

describe('utilities', () => {
  it('describes header formats without values', () => {
    expect(describeFormat('req_0123456789abcdef0123456789abcdef')).toBe('req_ + [0-9a-f]{32}')
    expect(describeFormat('312')).toBe('integer(3 digits)')
    expect(describeFormat('Sat, 22 Nov 2026 08:50:28 GMT')).toBe('http-date')
    expect(describeFormat('some value with spaces')).toBe('text(22 chars)')
    expect(idPattern('msg_01XFDUDYJgAACzvnptvVoYEL')).toBe('msg_[0-9A-Za-z]')
    expect(idPattern('6f1c2a3e-8b7d-4c1a-9e2f-0a1b2c3d4e5f')).toBe('uuid')
  })

  it('computes quartiles', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5)
    expect(summarize([1, 2, 3, 4, 100])).toMatchObject({ n: 5, median: 3, q1: 2, q3: 4 })
  })

  it('parses SSE framing across chunk boundaries', () => {
    const events: Array<{ event?: string; data: string }> = []
    const p = new SseParser(e => events.push(e))
    p.push('event: a\ndata: {"x"')
    p.push(':1}\n\n: comment\ndata: line1\ndata: line2\r\n\r\n')
    p.end()
    expect(events).toEqual([{ event: 'a', data: '{"x":1}' }, { data: 'line1\nline2' }])
  })
})

describe('origin-bound transport', () => {
  let url = ''
  let hits: Array<{ path: string; auth?: string }> = []
  let mode: 'ok' | 'redirect' | 'rate' | 'slow' = 'ok'
  let rateCount = 0
  const server = createServer((req, res) => {
    hits.push({ path: req.url ?? '', auth: req.headers.authorization })
    if (mode === 'redirect') { res.writeHead(302, { location: 'https://evil.example/steal' }); res.end(); return }
    if (mode === 'rate' && rateCount++ < 2) { res.writeHead(429, { 'retry-after': '0' }); res.end('{}'); return }
    if (mode === 'slow') { setTimeout(() => { res.writeHead(200); res.end('{}') }, 500); return }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"ok":true}')
  })
  beforeAll(async () => {
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => new Promise<void>(r => { server.closeAllConnections(); server.close(() => r()) }))
  const opts = { timeoutMs: 2000, maxRetries: 3, minIntervalMs: 0, maxBackoffMs: 50, maxIntervalMs: 2000 }

  it('joins paths and refuses another origin', () => {
    expect(joinURL('https://a.example/v1/', '/chat/completions')).toBe('https://a.example/v1/chat/completions')
    const t = new OriginTransport('https://a.example', 'https://a.example/v1', 'openai-completions', 'k', {}, opts)
    // An absolute-looking path can never escape: it is joined under the bound base.
    expect(new URL(t.url('https://b.example/x')).origin).toBe('https://a.example')
    expect(new URL(t.url('//b.example/x')).origin).toBe('https://a.example')
    // A base on another origin than the bound one is refused outright.
    const misbound = new OriginTransport('https://a.example', 'https://b.example/v1', 'openai-completions', 'k', {}, opts)
    expect(() => misbound.url('chat/completions')).toThrow(OriginMismatchError)
  })

  it('attaches the key only to its own origin and never follows redirects', async () => {
    hits = []
    mode = 'redirect'
    const t = new OriginTransport(new URL(url).origin, `${url}/v1`, 'openai-completions', 'secret-123', { authorization: 'Bearer override' }, opts)
    const r = await t.send('chat/completions', {})
    expect(r.ok).toBe(false)
    expect(r.transportError).toContain('redirect refused')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.auth).toBe('Bearer secret-123')
  })

  it('retries 429 with backoff and slows down afterwards', async () => {
    mode = 'rate'
    rateCount = 0
    const t = new OriginTransport(new URL(url).origin, url, 'openai-completions', 'k', {}, opts)
    const attempts: number[] = []
    const r = await t.send('x', {}, { meter: { beforeAttempt: a => { attempts.push(a) } } })
    expect(r.ok).toBe(true)
    expect(r.attempts).toBe(3)
    expect(attempts).toEqual([0, 1, 2])
    expect(t.rateLimited).toBe(2)
    expect(t.currentIntervalMs).toBeGreaterThanOrEqual(1000)
  })

  it('times out', async () => {
    mode = 'slow'
    const t = new OriginTransport(new URL(url).origin, url, 'openai-completions', 'k', {}, { ...opts, timeoutMs: 100, maxRetries: 0 })
    const r = await t.send('x', {})
    expect(r.transportError).toContain('timeout')
    mode = 'ok'
  })

  it('stops when the meter refuses (budget)', async () => {
    const t = new OriginTransport(new URL(url).origin, url, 'openai-completions', 'k', {}, opts)
    await expect(t.send('x', {}, { meter: { beforeAttempt: () => { throw new BudgetExceededError('no') } } })).rejects.toThrow(BudgetExceededError)
  })

  it('parses Retry-After and bounds backoff', () => {
    expect(parseRetryAfter('2')).toBe(2000)
    expect(parseRetryAfter(new Date(Date.now() + 5000).toUTCString())).toBeGreaterThan(3000)
    expect(parseRetryAfter(null)).toBeUndefined()
    expect(backoffMs(10, 30_000, () => 1)).toBe(30_000)
    expect(backoffMs(0, 30_000, () => 0)).toBe(500)
  })
})

describe('budget', () => {
  it('estimates and detects limit violations', () => {
    const plan = [
      { endpoint: 'target' as const, probe: 'a', inputTokens: 1000, outputTokens: 100 },
      { endpoint: 'reference' as const, probe: 'a', inputTokens: 1000, outputTokens: 100, free: true },
    ]
    const est = estimate(plan, { target: 'claude-opus-4-1' }, DEFAULT_BUDGET)
    expect(est.requests).toBe(2)
    expect(est.inputTokens).toBe(1000)
    expect(est.costUsd).toBeCloseTo((1000 * 15 + 100 * 75) / 1e6)
    expect(exceeds(est, DEFAULT_BUDGET)).toBeUndefined()
    expect(exceeds(est, { ...DEFAULT_BUDGET, maxRequests: 1 })).toContain('请求数')
    expect(exceeds(est, { ...DEFAULT_BUDGET, maxCostUsd: 0.001 })).toContain('费用')
    const unknown = estimate(plan, { target: 'mystery-model' }, DEFAULT_BUDGET)
    expect(unknown.priceNotes.join()).toContain('保守')
  })

  it('tracker refuses before overspending', () => {
    const t = new BudgetTracker({ ...DEFAULT_BUDGET, maxRequests: 2 }, { target: 'gpt-4o' })
    t.reserve('target', 10, 10); t.record('target', 10, 10)
    t.reserve('target', 10, 10); t.record('target', 10, 10)
    expect(() => t.reserve('target', 10, 10)).toThrow(BudgetExceededError)
    expect(t.snapshot()).toMatchObject({ requests: 2, inputTokens: 20, outputTokens: 20 })
  })
})

describe('endpoint resolution and key safety', () => {
  it('resolves credentials via the DSH credentials service first', async () => {
    const creds = { resolve: async (ref: string) => ref === 'RELAY_KEY' ? { value: 'from-store', source: 'file' } : undefined }
    await expect(resolveSecret(services({ credentials: creds }), 'RELAY_KEY', OPTS)).resolves.toEqual({ value: 'from-store', source: 'credentials:file' })
    await expect(resolveSecret(services({ credentials: creds }), 'OTHER', OPTS)).rejects.toThrow(ResolveError)
    await expect(resolveSecret(services(), 'sk-raw-key-not-a-ref', OPTS)).rejects.toThrow(/POSIX identifier/)
  })

  it('falls back to env, then to an owner-only $DSH_HOME/.credentials.yaml', async () => {
    const home = await mkdtemp(join(tmpdir(), 'fp-home-'))
    await expect(resolveSecret(services(), 'X_KEY', { ...OPTS, env: { X_KEY: 'env-value' }, dshHome: home })).resolves.toEqual({ value: 'env-value', source: 'env' })
    const file = join(home, '.credentials.yaml')
    await writeFile(file, 'version: 1\nrefs:\n  X_KEY: file-value\n')
    await chmod(file, 0o600)
    await expect(resolveSecret(services(), 'X_KEY', { ...OPTS, env: {}, dshHome: home })).resolves.toEqual({ value: 'file-value', source: 'file' })
    if (process.platform !== 'win32') {
      await chmod(file, 0o644)
      await expect(resolveSecret(services(), 'X_KEY', { ...OPTS, env: {}, dshHome: home })).rejects.toThrow(/readable by other users/)
    }
  })

  it('reads a provider route from the profile patch (later layer wins, !!js tolerated)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'fp-prof-'))
    const profile = join(home, 'profiles', 'web')
    await import('node:fs/promises').then(fs => fs.mkdir(profile, { recursive: true }))
    await writeFile(join(profile, 'cordis.patch.yml'), [
      '- id: llm-pi-ai',
      '  config:',
      '    providers:',
      '      my-relay:',
      '        apiKeyEnv: RELAY_KEY',
      '        api: anthropic-messages',
      '        baseURL: https://relay.example',
      '        headers: { X-Team: blue }',
      '- id: other',
      '  config:',
      '    root: !!js dshHomePath("x")',
    ].join('\n'))
    const route = await routeFromPatchFiles([join(profile, 'cordis.patch.yml'), join(home, 'cordis.patch.yml')], 'my-relay')
    expect(route).toMatchObject({ api: 'anthropic-messages', baseURL: 'https://relay.example', apiKeyEnv: 'RELAY_KEY', headers: { 'X-Team': 'blue' } })
    const target = await resolveTarget(services(), { providerId: 'my-relay' }, 'claude-sonnet-4-5', { ...OPTS, dshHome: home, env: { RELAY_KEY: 'rk-1234567890' } })
    expect(target.info).toMatchObject({ protocol: 'anthropic-messages', origin: 'https://relay.example', model: 'claude-sonnet-4-5', official: false })
    expect(target.headers).toEqual({ 'X-Team': 'blue' })
  })

  it('prefers the live Loader composition (Volatile config) over files', async () => {
    const loader = { entries: () => [{ options: { id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai' }, fiber: { effectiveConfig: { providers: { get: () => ({ gw: { api: 'openai-completions', baseURL: 'https://gw.example/v1', apiKeyEnv: 'GW', compat: { maxTokensField: 'max_completion_tokens' } } }) } } } }] }
    const target = await resolveTarget(services({ loader }), { providerId: 'gw' }, 'gpt-4o', { ...OPTS, env: { GW: 'gw-key-12345678' } })
    expect(target.info.baseURL).toBe('https://gw.example/v1')
    expect(target.adapterOptions.maxTokensField).toBe('max_completion_tokens')
  })

  it('refuses non-official references, insecure URLs, and official-key reuse on relays', async () => {
    const env = { OFFICIAL: 'official-key-123456', RELAY: 'official-key-123456' }
    await expect(resolveReference(services(), { baseURL: 'https://relay.example', apiKeyEnv: 'OFFICIAL' }, 'claude-sonnet-4-5', { ...OPTS, env })).rejects.toThrow(/not an official host/)
    await expect(resolveTarget(services(), { baseURL: 'http://relay.example/v1', protocol: 'openai-completions', apiKeyEnv: 'RELAY' }, 'gpt-4o', { ...OPTS, env })).rejects.toThrow(/https/)
    await expect(resolveTarget(services(), { baseURL: 'https://relay.example/v1?key=1', protocol: 'openai-completions', apiKeyEnv: 'RELAY' }, 'gpt-4o', { ...OPTS, env })).rejects.toThrow(/query/)
    const target = await resolveTarget(services(), { baseURL: 'https://relay.example/v1', protocol: 'openai-completions', apiKeyEnv: 'RELAY' }, 'gpt-4o', { ...OPTS, env })
    const reference = await resolveReference(services(), { apiKeyEnv: 'OFFICIAL' }, 'gpt-4o', { ...OPTS, env })
    expect(reference.info).toMatchObject({ origin: 'https://api.openai.com', protocol: 'openai-responses', official: true })
    expect(() => assertKeySeparation(target, reference)).toThrow(/same key/)
    const gpt5 = await resolveTarget(services(), { baseURL: 'https://relay.example/v1', protocol: 'openai-completions', apiKeyEnv: 'RELAY' }, 'gpt-5', { ...OPTS, env })
    expect(gpt5.adapterOptions.maxTokensField).toBe('max_completion_tokens')
    expect(target.adapterOptions.maxTokensField).toBe('max_tokens')
    expect(isOfficialOrigin('http://127.0.0.1:9', ['127.0.0.1:9'])).toBe(true)
    expect(isOfficialOrigin('http://127.0.0.1:10', ['127.0.0.1:9'])).toBe(false)
  })
})
