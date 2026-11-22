/**
 * Verdict rules (fixed by the plugin's contract):
 *   - any strong mismatch                                  → inconsistent (不一致)
 *   - a strong match and no mismatch of medium or stronger → consistent (一致)
 *   - otherwise                                            → suspicious (可疑), with reasons
 * Confidence is a bounded heuristic in (0, 1); it never reaches certainty.
 */
import type { Evidence, EvidenceCategory, Verdict } from './types.ts'

export const VERDICT_LABEL: Record<Verdict, string> = {
  consistent: '一致',
  inconsistent: '不一致',
  suspicious: '可疑',
  'not-run': '未执行',
}

export interface Score {
  verdict: Verdict
  confidence: number
  confidenceLabel: string
  reasons: string[]
  counts: Record<'strongMatch' | 'mediumMatch' | 'weakMatch' | 'strongMismatch' | 'mediumMismatch' | 'weakMismatch' | 'inconclusive', number>
  categories: Record<EvidenceCategory, CategoryStatus>
}

export interface CategoryStatus { status: 'detected' | 'suspected' | 'not-detected' | 'unknown'; label: string; evidence: string[] }

const MAX_CONFIDENCE = 0.97

export function confidenceLabel(c: number): string {
  if (c >= 0.9) return '高'
  if (c >= 0.75) return '较高'
  if (c >= 0.55) return '中等'
  return '低'
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function count(evidence: readonly Evidence[], result: Evidence['result'], strength?: Evidence['strength']): number {
  return evidence.filter(e => e.result === result && (strength === undefined || e.strength === strength)).length
}

export function categoryStatus(evidence: readonly Evidence[], category: EvidenceCategory): CategoryStatus {
  const own = evidence.filter(e => (e.category ?? 'substitution') === category)
  const strongBad = own.filter(e => e.result === 'mismatch' && e.strength === 'strong')
  const bad = own.filter(e => e.result === 'mismatch' && e.strength !== 'weak')
  const weakBad = own.filter(e => e.result === 'mismatch' && e.strength === 'weak')
  const good = own.filter(e => e.result === 'match' && e.strength !== 'weak')
  const names = (list: Evidence[]): string[] => list.map(e => e.probe)
  if (strongBad.length > 0) return { status: 'detected', label: '发现', evidence: names(strongBad) }
  if (bad.length > 0) return { status: 'suspected', label: '疑似', evidence: names(bad) }
  if (weakBad.length > 0 && good.length === 0) return { status: 'suspected', label: '弱迹象', evidence: names(weakBad) }
  if (good.length > 0) return { status: 'not-detected', label: '未发现', evidence: names(good) }
  return { status: 'unknown', label: '无法判断', evidence: [] }
}

export function score(evidence: readonly Evidence[]): Score {
  const counts = {
    strongMatch: count(evidence, 'match', 'strong'),
    mediumMatch: count(evidence, 'match', 'medium'),
    weakMatch: count(evidence, 'match', 'weak'),
    strongMismatch: count(evidence, 'mismatch', 'strong'),
    mediumMismatch: count(evidence, 'mismatch', 'medium'),
    weakMismatch: count(evidence, 'mismatch', 'weak'),
    inconclusive: count(evidence, 'inconclusive'),
  }
  const categories = {
    substitution: categoryStatus(evidence, 'substitution'),
    injection: categoryStatus(evidence, 'injection'),
    parameters: categoryStatus(evidence, 'parameters'),
  }
  const reasons: string[] = []
  let verdict: Verdict
  let confidence: number

  if (counts.strongMismatch > 0) {
    verdict = 'inconsistent'
    confidence = 0.8 + 0.05 * (counts.strongMismatch - 1) + 0.03 * counts.mediumMismatch
    // Conflicting strong evidence about the SAME question (e.g. tokenizer matches on some
    // requests and not on others) is typical of mixed routing. A genuine tokenizer plus an
    // injected prompt is not a conflict: those answer different questions.
    const conflicting = (['substitution', 'injection', 'parameters'] as const).some(cat =>
      evidence.some(e => (e.category ?? 'substitution') === cat && e.strength === 'strong' && e.result === 'match')
      && evidence.some(e => (e.category ?? 'substitution') === cat && e.strength === 'strong' && e.result === 'mismatch'))
    if (conflicting) {
      confidence -= 0.1
      reasons.push('同时存在强一致与强不一致证据，可能是混合路由（部分请求走真模型）')
    }
    confidence = clamp(confidence, 0.6, MAX_CONFIDENCE)
    for (const e of evidence.filter(x => x.result === 'mismatch' && x.strength === 'strong')) reasons.push(`[强] ${e.probe}: ${e.detail}`)
  } else if (counts.strongMatch > 0 && counts.mediumMismatch === 0) {
    verdict = 'consistent'
    confidence = 0.7 + 0.07 * (counts.strongMatch - 1) + 0.03 * counts.mediumMatch - 0.05 * counts.weakMismatch
    confidence = clamp(confidence, 0.55, 0.95)
    if (counts.weakMismatch > 0) reasons.push(`另有 ${counts.weakMismatch} 条弱证据不一致（不影响结论，见证据表）`)
  } else {
    verdict = 'suspicious'
    if (counts.strongMatch === 0) reasons.push('没有任何强证据给出一致结论（缺少 reference/基线，或强探针未得出结果）')
    for (const e of evidence.filter(x => x.result === 'mismatch' && x.strength === 'medium')) reasons.push(`[中] ${e.probe}: ${e.detail}`)
    for (const e of evidence.filter(x => x.result === 'mismatch' && x.strength === 'weak')) reasons.push(`[弱] ${e.probe}: ${e.detail}`)
    const mismatchSignal = counts.mediumMismatch + counts.weakMismatch
    confidence = mismatchSignal === 0
      ? 0.3
      : clamp(0.45 + 0.1 * counts.mediumMismatch + 0.03 * counts.weakMismatch, 0.45, 0.8)
  }
  return { verdict, confidence: Math.round(confidence * 100) / 100, confidenceLabel: confidenceLabel(confidence), reasons, counts, categories }
}
