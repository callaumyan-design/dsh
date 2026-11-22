import { describe, expect, it } from 'vitest'
import { compareDelta, CORPUS, MINIMAL_PROMPT, segmentPrompt, tiktokenDelta, countTiktoken, estimateChatPromptTokens, isSingleToken } from '../src/tokenizer.ts'
import { deltaEvidence } from '../src/probes/tokenizer.ts'
import { classifyReplay, mutateSignature, sameRejection, withSignature, replayParams, type ReplayOutcome } from '../src/probes/signature.ts'
import { evaluateLogprobs, evaluateMaxTokens, evaluateStop, evaluateTemperature, evaluateToolCall } from '../src/probes/params.ts'
import { mentionedVendors, selfIdentificationEvidence, similarityEvidence } from '../src/probes/behavior.ts'
import { compareSpeed } from '../src/probes/performance.ts'
import type { GenerationResult } from '../src/types.ts'

function gen(partial: Partial<GenerationResult>): GenerationResult {
  return { ok: true, status: 200, headers: {}, latencyMs: 1, text: '', stop: 'stop', usage: {}, toolCalls: [], signatures: [], ...partial }
}

describe('differential tokenizer', () => {
  it.each([
    [10, 10, 'match'], [100, 103, 'match'], [10, 11, 'match'], [10, 12, 'near'], [100, 110, 'near'],
    [10, 14, 'mismatch'], [100, 120, 'mismatch'], [40, 20, 'mismatch'],
  ] as const)('observed %i vs expected %i → %s', (o, e, v) => {
    expect(compareDelta('x', o, e).verdict).toBe(v)
  })

  it('aggregates segments into strong/medium evidence', () => {
    const mk = (verdicts: Array<'match' | 'near' | 'mismatch'>) => verdicts.map((v, i) => ({ segment: `s${i}`, observed: 10, expected: 10, diff: 0, verdict: v }))
    expect(deltaEvidence(mk(Array(9).fill('match')), 'tiktoken')).toMatchObject({ strength: 'strong', result: 'match' })
    expect(deltaEvidence(mk([...Array(5).fill('mismatch'), ...Array(4).fill('match')]), 'x')).toMatchObject({ strength: 'strong', result: 'mismatch' })
    expect(deltaEvidence(mk([...Array(4).fill('mismatch'), ...Array(5).fill('match')]), 'x')).toMatchObject({ strength: 'strong', result: 'mismatch' })
    expect(deltaEvidence(mk([...Array(3).fill('mismatch'), ...Array(6).fill('match')]), 'x')).toMatchObject({ strength: 'medium', result: 'mismatch' })
    expect(deltaEvidence(mk([...Array(1).fill('mismatch'), ...Array(8).fill('match')]), 'x')).toMatchObject({ result: 'inconclusive' })
    expect(deltaEvidence(mk([...Array(4).fill('near'), ...Array(5).fill('match')]), 'x')).toMatchObject({ result: 'inconclusive' })
    expect(deltaEvidence(mk(['match', 'match']), 'x')).toMatchObject({ result: 'inconclusive' })
  })

  it('tiktoken deltas cancel the minimal prompt and differ by script', async () => {
    const en = CORPUS.find(s => s.id === 'en')!
    const delta = await tiktokenDelta('o200k_base', en)
    expect(delta).toBe(await countTiktoken('o200k_base', segmentPrompt(en)) - await countTiktoken('o200k_base', MINIMAL_PROMPT))
    expect(delta).toBeGreaterThan(15)
    const zhO200k = await tiktokenDelta('o200k_base', CORPUS.find(s => s.id === 'zh')!)
    const zhCl100k = await tiktokenDelta('cl100k_base', CORPUS.find(s => s.id === 'zh')!)
    expect(zhO200k).not.toBe(zhCl100k)
    expect(await estimateChatPromptTokens('o200k_base', MINIMAL_PROMPT)).toBe(7 + await countTiktoken('o200k_base', MINIMAL_PROMPT))
    expect(await isSingleToken('o200k_base', ' the')).toBe(true)
    expect(await isSingleToken('o200k_base', 'antidisestablishmentarianism')).toBe(false)
  })
})

describe('signature replay calibration', () => {
  const accepted: ReplayOutcome = { accepted: true, status: 200 }
  const rejected: ReplayOutcome = { accepted: false, status: 400, errorType: 'invalid_request_error', message: 'Invalid `signature` in `thinking` block' }
  const otherError: ReplayOutcome = { accepted: false, status: 529, errorType: 'overloaded_error', message: 'Overloaded' }

  it.each([
    ['positive control rejected', rejected, rejected, accepted, 'inconclusive'],
    ['negative control accepted', accepted, accepted, accepted, 'inconclusive'],
    ['target accepted', accepted, rejected, accepted, 'match'],
    ['target rejected like negative', accepted, rejected, rejected, 'mismatch'],
    ['target rejected differently', accepted, rejected, otherError, 'inconclusive'],
  ] as const)('%s → %s', (_n, pos, neg, test, result) => {
    expect(classifyReplay(pos, neg, test, 'anthropic-thinking', 'strong').result).toBe(result)
  })

  it('mismatch strength follows the vendor (OpenAI/Gemini medium)', () => {
    expect(classifyReplay(accepted, rejected, rejected, 'openai-encrypted-reasoning', 'medium').strength).toBe('medium')
    expect(classifyReplay(accepted, rejected, accepted, 'openai-encrypted-reasoning', 'medium').strength).toBe('strong')
  })

  it('compares rejections by status + type or by wording, never by hard-coded codes', () => {
    expect(sameRejection({ accepted: false, status: 400, message: 'The encrypted content for item rs_123abc could not be verified.' }, { accepted: false, status: 400, message: 'The encrypted content for item rs_999fff could not be verified.' })).toBe(true)
    expect(sameRejection(rejected, { ...rejected, status: 401 })).toBe(false)
  })

  it('mutates signatures in place and rebuilds replay requests', () => {
    const sig = 'EqQBCgIYAhIM1gbcDa9GJwZA2b3hGgxBdjrkzLoky3dl1pkiMOYds5BZ2MlWBz6IpJkUdkOzhBYJGEjpCjSjbjuEdeA4ZRXYnRKx'
    const m = mutateSignature(sig)
    expect(m).not.toBe(sig)
    expect(m).toHaveLength(sig.length)
    const artifact = { kind: 'anthropic-thinking' as const, value: sig, items: [{ type: 'thinking', thinking: 't', signature: sig }, { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Paris' } }] }
    const tampered = withSignature(artifact, m)
    expect((tampered.items[0] as { signature: string }).signature).toBe(m)
    expect((artifact.items[0] as { signature: string }).signature).toBe(sig)
    const params = replayParams(tampered, '', 'enabled')!
    expect(params.nativeMessages).toHaveLength(3)
    expect(params.thinking?.budgetTokens).toBe(1024)
  })
})

describe('parameter evaluators', () => {
  it('max_tokens', () => {
    expect(evaluateMaxTokens(gen({ usage: { outputTokens: 17 }, stop: 'length', stopReason: 'max_tokens' })).result).toBe('match')
    expect(evaluateMaxTokens(gen({ usage: { outputTokens: 400 }, stop: 'stop' })).result).toBe('mismatch')
    expect(evaluateMaxTokens(gen({ usage: { outputTokens: 5 }, stop: 'stop' })).result).toBe('inconclusive')
    expect(evaluateMaxTokens(gen({ usage: {} })).result).toBe('inconclusive')
    // Thinking tokens billed outside the visible cap (Gemini-style) are not a violation.
    expect(evaluateMaxTokens(gen({ usage: { outputTokens: 60, reasoningTokens: 50 }, stop: 'length' })).result).toBe('inconclusive')
    expect(evaluateMaxTokens(gen({ usage: { outputTokens: 60, reasoningTokens: 10 }, stop: 'length' })).result).toBe('mismatch')
  })

  it('stop sequences', () => {
    expect(evaluateStop(gen({ text: 'alpha beta ', stop: 'stop_sequence', stopReason: 'stop_sequence' }), true, true)).toMatchObject({ result: 'match', strength: 'medium' })
    expect(evaluateStop(gen({ text: 'alpha beta gamma delta epsilon' }), true, false).result).toBe('mismatch')
    expect(evaluateStop(gen({ ok: false, status: 400 }), false, false)).toMatchObject({ result: 'match', strength: 'weak' })
    expect(evaluateStop(gen({ text: 'alpha beta ' }), false, false)).toMatchObject({ result: 'mismatch', strength: 'medium' })
    expect(evaluateStop(gen({ text: 'alpha beta ', stopReason: 'end_turn' }), true, true).result).toBe('inconclusive')
  })

  it('temperature stability', () => {
    expect(evaluateTemperature(['same text', 'same text', 'same text'], undefined, '').result).toBe('match')
    expect(evaluateTemperature(['a cat sat on mats', 'quantum fields bend light', 'zebra 42 ocean'], undefined, '').result).toBe('mismatch')
    expect(evaluateTemperature(['a cat sat on mats', 'quantum fields bend light', 'zebra 42 ocean'], 1, 'ref').result).toBe('mismatch')
    expect(evaluateTemperature(['one'], undefined, '').result).toBe('inconclusive')
    expect(evaluateTemperature(['', '', ''], undefined, '').result).toBe('inconclusive')
  })

  it('tool call format', () => {
    const native = { vendor: 'anthropic' as const, targetProtocol: 'anthropic-messages' as const }
    expect(evaluateToolCall(gen({ stopReason: 'tool_use', toolCalls: [{ id: 'toolu_01A09q90qw90lq917835lq9', name: 'get_weather', arguments: { city: 'Paris' } }] }), native).result).toBe('match')
    expect(evaluateToolCall(gen({ stopReason: 'tool_use', toolCalls: [{ id: 'call_abc', name: 'get_weather', arguments: { city: 'Paris' } }] }), native).result).toBe('mismatch')
    expect(evaluateToolCall(gen({ toolCalls: [] }), native).result).toBe('mismatch')
    expect(evaluateToolCall(gen({ toolCalls: [], stop: 'length' }), native).result).toBe('inconclusive')
    const chat = { vendor: 'openai' as const, targetProtocol: 'openai-completions' as const }
    expect(evaluateToolCall(gen({ toolCalls: [{ id: 'call_abc123XYZ456def789', name: 'get_weather', arguments: '{"city":"Paris"}' }] }), chat).result).toBe('match')
    expect(evaluateToolCall(gen({ toolCalls: [{ id: 'call_abc123XYZ456def789', name: 'get_weather', arguments: { city: 'Paris' } }] }), chat).result).toBe('mismatch')
  })

  it('logprobs', async () => {
    const tokens = ['the', ' sky', ' is', ' blue'].map(token => ({ token, logprob: -0.1 }))
    expect((await evaluateLogprobs(gen({ logprobs: tokens }), true, 'gpt-4o')).result).toBe('match')
    expect((await evaluateLogprobs(gen({ logprobs: null }), true, 'gpt-4o')).result).toBe('mismatch')
    const bad = ['the sky is', ' blue and green', ' antidisestablishment'].map(token => ({ token, logprob: -0.1 }))
    expect((await evaluateLogprobs(gen({ logprobs: bad }), true, 'gpt-4o')).result).toBe('mismatch')
    expect((await evaluateLogprobs(gen({ logprobs: tokens }), false, 'o3')).result).toBe('mismatch')
    expect((await evaluateLogprobs(gen({ ok: false, status: 400 }), false, 'o3')).result).toBe('match')
  })
})

describe('behavior and performance evaluators', () => {
  it('vendor mentions and self identification', () => {
    expect(mentionedVendors('我是 DeepSeek-V3，由深度求索开发')).toEqual(['deepseek'])
    expect(selfIdentificationEvidence('anthropic', { banner: "I'm ChatGPT by OpenAI" })).toMatchObject({ result: 'mismatch', strength: 'weak' })
    expect(selfIdentificationEvidence('anthropic', { banner: "I'm Claude, made by Anthropic." })).toMatchObject({ result: 'match', strength: 'weak' })
  })

  it('n-gram similarity against reference answers', () => {
    const ref = { a: ['I am Claude by Anthropic.'], b: ['January 2025'], c: ['3'] }
    expect(similarityEvidence({ a: 'I am Claude by Anthropic.', b: 'January 2025', c: '3' }, ref, 'ref')?.result).toBe('match')
    expect(similarityEvidence({ a: '我是通义千问', b: '2023年10月', c: '两个' }, ref, 'ref')?.result).toBe('mismatch')
    expect(similarityEvidence({ a: 'x' }, ref, 'ref')).toBeUndefined()
  })

  it('speed comparison', () => {
    expect(compareSpeed([50, 55, 60], [52, 58, 61], 'ref').result).toBe('match')
    expect(compareSpeed([300, 320, 310], [50, 55, 60], 'ref').result).toBe('mismatch')
    expect(compareSpeed([], [50], 'ref').result).toBe('inconclusive')
  })
})
