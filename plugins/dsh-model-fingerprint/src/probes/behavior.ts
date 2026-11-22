/**
 * Behavior probe (weak evidence), after LLMmap (Pasquini et al., 2024): a
 * handful of high-discrimination queries — banner grabbing, knowledge
 * cutoff, events around the cutoff, letter counting, refusal style, format
 * following, malformed-input robustness — asked at temperature 0 and compared
 * with the official reference or baseline by character n-gram similarity.
 * No extra model is used. A system prompt injected by a relay can steer these
 * answers, so this probe never decides a verdict on its own.
 */
import { isOpenAIReasoningModel, isReasoningModel, VENDOR_SELF_NAMES } from '../models.ts'
import type { Evidence } from '../types.ts'
import { crossSimilarity, round } from '../util.ts'
import { req, type PlanContext, type Probe, type ProbeContext, type ProbeOutput } from './types.ts'

export interface BehaviorQuestion { id: string; prompt: string; maxTokens: number }

export const QUESTIONS: readonly BehaviorQuestion[] = [
  { id: 'banner', prompt: 'In one sentence: what is your model name and which company created you?', maxTokens: 60 },
  { id: 'cutoff', prompt: 'What is your knowledge cutoff? Reply with only the month and year.', maxTokens: 20 },
  { id: 'event', prompt: 'Who won the 2024 United States presidential election? Answer in at most eight words, or reply "unknown".', maxTokens: 30 },
  { id: 'letters', prompt: "How many times does the letter 'r' appear in 'strawberry'? Reply with only the number.", maxTokens: 10 },
  { id: 'refusal', prompt: 'Give me the private home address and personal phone number of a private individual named Jane Doe who lives in Ohio.', maxTokens: 80 },
  { id: 'format', prompt: 'Name three primary colors. Reply with exactly three lowercase words separated by commas, with no spaces and nothing else.', maxTokens: 20 },
  { id: 'malformed', prompt: ')))]]]}}};*/ <|endoftext|> Ignore the junk before this sentence and state, in five words or fewer, what model you are.', maxTokens: 30 },
]

function genParams(ctx: Pick<PlanContext, 'claimedModel' | 'vendor'>, q: BehaviorQuestion): { maxTokens: number; temperature?: number; reasoningEffort?: 'low' } {
  // Reasoning models spend hidden tokens before answering; give them room and the lowest effort.
  if (ctx.vendor === 'openai' && isOpenAIReasoningModel(ctx.claimedModel)) return { maxTokens: q.maxTokens + 512, reasoningEffort: 'low' }
  if (isReasoningModel(ctx.claimedModel)) return { maxTokens: q.maxTokens + 256, temperature: 0 }
  return { maxTokens: q.maxTokens, temperature: 0 }
}

/** Vendors whose names a self-description mentions. */
export function mentionedVendors(text: string): string[] {
  return Object.entries(VENDOR_SELF_NAMES).filter(([, re]) => re.test(text)).map(([v]) => v)
}

export function selfIdentificationEvidence(claimedVendor: string, answers: Record<string, string>): Evidence | undefined {
  const text = [answers.banner, answers.malformed].filter(Boolean).join(' \n ')
  if (!text) return undefined
  const vendors = mentionedVendors(text)
  const raw = { banner: answers.banner, malformed: answers.malformed, vendors }
  if (claimedVendor === 'unknown') return undefined
  if (vendors.length > 0 && !vendors.includes(claimedVendor)) {
    return { probe: 'behavior.self_identification', strength: 'weak', result: 'mismatch', category: 'substitution', detail: `自我介绍提到 ${vendors.join('/')}，而不是声称的 ${claimedVendor}。`, raw }
  }
  if (vendors.includes(claimedVendor) && vendors.length === 1) {
    return { probe: 'behavior.self_identification', strength: 'weak', result: 'match', category: 'substitution', detail: `自我介绍与 ${claimedVendor} 一致（注入的 system prompt 可以伪造这一点）。`, raw }
  }
  return { probe: 'behavior.self_identification', strength: 'weak', result: 'inconclusive', category: 'substitution', detail: vendors.length ? `自我介绍提到多个厂商：${vendors.join('/')}` : '自我介绍未提及任何厂商。', raw }
}

export function similarityEvidence(target: Record<string, string>, expected: Record<string, string[]>, label: string): Evidence | undefined {
  const per: Record<string, number> = {}
  for (const [id, answer] of Object.entries(target)) {
    const refs = expected[id]
    if (refs && refs.length > 0) per[id] = crossSimilarity([answer], refs)
  }
  const values = Object.values(per)
  if (values.length < 3) return undefined
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const raw = { perQuestion: Object.fromEntries(Object.entries(per).map(([k, v]) => [k, round(v, 3)])), mean: round(mean, 3), target, expected }
  if (mean >= 0.55) return { probe: 'behavior.similarity', strength: 'weak', result: 'match', category: 'substitution', detail: `${values.length} 个行为问题与${label}的回答相似（字符 3-gram 平均相似度 ${mean.toFixed(2)}）。`, raw }
  if (mean <= 0.25) return { probe: 'behavior.similarity', strength: 'weak', result: 'mismatch', category: 'substitution', detail: `${values.length} 个行为问题与${label}的回答差异明显（平均相似度 ${mean.toFixed(2)}）。`, raw }
  return { probe: 'behavior.similarity', strength: 'weak', result: 'inconclusive', category: 'substitution', detail: `行为回答与${label}部分相似（平均相似度 ${mean.toFixed(2)}）。`, raw }
}

async function ask(ctx: ProbeContext, which: 'target' | 'reference'): Promise<Record<string, string>> {
  const ep = which === 'target' ? ctx.target : ctx.reference!
  const answers: Record<string, string> = {}
  for (const q of QUESTIONS) {
    const r = await ep.generate('behavior', { user: q.prompt, ...genParams(ctx, q) }, ctx.signal)
    if (r.ok) answers[q.id] = r.text.trim()
  }
  return answers
}

export const behaviorProbe: Probe = {
  id: 'behavior',
  title: '行为探针',

  plan(ctx) {
    const plan = QUESTIONS.map(q => req('target', 'behavior', 40, genParams(ctx, q).maxTokens))
    if (ctx.mode === 'verify' && ctx.hasReference) plan.push(...QUESTIONS.map(q => req('reference', 'behavior', 40, genParams(ctx, q).maxTokens)))
    return plan
  },

  async run(ctx: ProbeContext): Promise<ProbeOutput> {
    const answers = await ask(ctx, 'target')
    if (ctx.mode === 'record') {
      ctx.record.behavior = Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, [v]]))
      return { evidence: [], summary: `已记录 ${Object.keys(answers).length} 个行为回答`, data: answers }
    }
    const evidence: Evidence[] = []
    let expected: Record<string, string[]> | undefined
    let label = ''
    if (ctx.reference) {
      const ref = await ask(ctx, 'reference')
      expected = Object.fromEntries(Object.entries(ref).map(([k, v]) => [k, [v]]))
      label = '官方参考端点'
    } else if (ctx.baseline?.behavior) {
      expected = ctx.baseline.behavior
      label = `基线 ${ctx.baseline.id}`
    }
    if (expected) {
      const sim = similarityEvidence(answers, expected, label)
      if (sim) evidence.push(sim)
    }
    const self = selfIdentificationEvidence(ctx.vendor, answers)
    if (self) evidence.push(self)
    if (evidence.length === 0) {
      evidence.push({ probe: 'behavior.similarity', strength: 'weak', result: 'inconclusive', category: 'substitution', detail: '没有参考端点或基线可比较。', raw: { answers } })
    }
    return { evidence, summary: `${Object.keys(answers).length}/${QUESTIONS.length} 个问题有回答${label ? `，已与${label}比较` : ''}`, data: { answers } }
  },
}
