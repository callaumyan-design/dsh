/**
 * The plugin inside a real Cordis context with the real @deepseek-ai/dsh-tools
 * registry: registration, argument validation by defineTool, canonical output
 * validated against the declared output schema, model-facing rendering.
 */
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ToolsService, { validateJsonSchemaValue, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import * as plugin from '../src/index.ts'
import { officialBehavior, startMock, type MockServer } from './mock/mock-llm.ts'

let ctx: Context
let official: MockServer
let relay: MockServer
let dataDir: string
const exec = () => ({ signal: new AbortController().signal }) as never

beforeAll(async () => {
  official = await startMock({ mode: 'official', apiKey: ['official-key-abcdefghijkl', 'upstream-key-abcdefghijkl'], behavior: officialBehavior('claude', 'claude') })
  relay = await startMock({ mode: 'proxy', apiKey: 'relay-key-abcdefghijklmn', upstream: { baseURL: official.url, apiKey: 'upstream-key-abcdefghijkl' } })
  process.env.FP_TEST_RELAY_KEY = 'relay-key-abcdefghijklmn'
  process.env.FP_TEST_OFFICIAL_KEY = 'official-key-abcdefghijkl'
  dataDir = await mkdtemp(join(tmpdir(), 'fp-plugin-'))
  ctx = new Context()
  // dsh-tools needs a system-prompt service; a stub section registry is enough here.
  ctx.provide('systemPrompt', { tools: () => () => {} })
  ctx.plugin(ToolsService)
  ctx.plugin(plugin, { dataDir, extraOfficialHosts: [new URL(official.url).host], minIntervalMs: 0 } as plugin.Config)
  await new Promise(r => setTimeout(r, 100))
})

afterAll(async () => {
  await relay.close()
  await official.close()
})

function tool(name: string): ToolDefinition {
  const t = ctx.tools.get(name)
  if (!t) throw new Error(`tool ${name} not registered`)
  return t
}

describe('plugin wiring', () => {
  it('exports the Cordis contract and registers three tools', () => {
    expect(plugin.name).toBe('model-fingerprint')
    expect(plugin.inject).toEqual(['tools'])
    expect(ctx.tools.definitions().map(d => d.name).sort()).toEqual(['model_fingerprint_list', 'model_fingerprint_record', 'model_fingerprint_verify'])
    const schema = tool('model_fingerprint_verify').parameters as { properties: Record<string, unknown>; required?: string[] }
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(['target', 'claimedModel', 'reference', 'probes', 'budget', 'samples']))
    expect(schema.required).toEqual(['target'])
  })

  it('defineTool rejects invalid arguments (e.g. unknown probe ids)', async () => {
    await expect(tool('model_fingerprint_verify').execute({ target: { baseURL: relay.url }, probes: ['nope'] }, exec())).rejects.toThrow()
  })

  it('verify runs end to end through the registry; output satisfies the declared schema', async () => {
    const t = tool('model_fingerprint_verify')
    const value = await t.execute({
      target: { baseURL: relay.url, protocol: 'anthropic-messages', model: 'claude-sonnet-4-5', apiKeyEnv: 'FP_TEST_RELAY_KEY' },
      reference: { baseURL: official.url, apiKeyEnv: 'FP_TEST_OFFICIAL_KEY' },
      probes: ['tokenizer', 'protocol'],
      samples: 2,
    }, exec()) as { markdown: string; report: { verdict: string } }
    expect(validateJsonSchemaValue(t.output.schema, value, '')).toEqual([])
    expect(value.report.verdict).toBe('consistent')
    const content = t.output.render({}, value as never)
    expect(content[0]?.type).toBe('text')
    const text = (content[0] as { text: string }).text
    expect(text).toContain('结论：一致')
    expect(text).toContain('```json')
    expect(text).not.toContain('relay-key-abcdefghijklmn')
    expect(text).not.toContain('official-key-abcdefghijkl')
  })

  it('a raw key passed as apiKeyEnv is refused, never sent', async () => {
    const before = relay.requests.length
    await expect(tool('model_fingerprint_verify').execute({ target: { baseURL: relay.url, protocol: 'anthropic-messages', model: 'claude-sonnet-4-5', apiKeyEnv: 'sk-ant-raw-secret-value' } }, exec())).rejects.toThrow(/POSIX identifier/)
    expect(relay.requests.length).toBe(before)
  })

  it('record + list through the registry', async () => {
    const rec = await tool('model_fingerprint_record').execute({ endpoint: { baseURL: official.url, protocol: 'anthropic-messages', apiKeyEnv: 'FP_TEST_OFFICIAL_KEY' }, model: 'claude-sonnet-4-5', probes: ['tokenizer'], samples: 1 }, exec()) as { report: { recorded: boolean } }
    expect(rec.report.recorded).toBe(true)
    const list = await tool('model_fingerprint_list').execute({}, exec()) as { report: { baselines: Array<{ model: string; probes: string[] }> } }
    expect(list.report.baselines).toHaveLength(1)
    expect(list.report.baselines[0]).toMatchObject({ model: 'claude-sonnet-4-5', probes: ['tokenizer'] })
  })

  it('unloading the plugin removes its tools (effect-owned registrations)', async () => {
    const other = new Context()
    other.provide('systemPrompt', { tools: () => () => {} })
    other.plugin(ToolsService)
    const fiber = other.plugin(plugin, { dataDir } as plugin.Config)
    await new Promise(r => setTimeout(r, 50))
    expect(other.tools.definitions()).toHaveLength(3)
    await fiber.dispose()
    await new Promise(r => setTimeout(r, 50))
    expect(other.tools.definitions()).toHaveLength(0)
  })
})
