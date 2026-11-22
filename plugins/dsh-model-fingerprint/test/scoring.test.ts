import { describe, expect, it } from 'vitest'
import { categoryStatus, confidenceLabel, score } from '../src/scoring.ts'
import type { Evidence, EvidenceCategory, Verdict } from '../src/types.ts'

type Spec = `${'S' | 'M' | 'W'}${'+' | '-' | '?'}` // strength + result
const STRENGTH = { S: 'strong', M: 'medium', W: 'weak' } as const
const RESULT = { '+': 'match', '-': 'mismatch', '?': 'inconclusive' } as const

function ev(spec: Spec, category: EvidenceCategory = 'substitution'): Evidence {
  return { probe: `p.${spec}`, strength: STRENGTH[spec[0] as 'S'], result: RESULT[spec[1] as '+'], detail: spec, raw: null, category }
}

const table: Array<{ name: string; evidence: Spec[]; verdict: Verdict }> = [
  { name: 'no evidence at all', evidence: [], verdict: 'suspicious' },
  { name: 'only inconclusive', evidence: ['S?', 'M?', 'W?'], verdict: 'suspicious' },
  { name: 'single strong match', evidence: ['S+'], verdict: 'consistent' },
  { name: 'strong match + weak mismatch', evidence: ['S+', 'W-'], verdict: 'consistent' },
  { name: 'strong match + medium mismatch', evidence: ['S+', 'M-'], verdict: 'suspicious' },
  { name: 'strong mismatch alone', evidence: ['S-'], verdict: 'inconsistent' },
  { name: 'strong mismatch beats strong match', evidence: ['S+', 'S-'], verdict: 'inconsistent' },
  { name: 'strong mismatch beats many matches', evidence: ['S+', 'S+', 'M+', 'M+', 'S-'], verdict: 'inconsistent' },
  { name: 'medium mismatches only', evidence: ['M-', 'M-', 'W+'], verdict: 'suspicious' },
  { name: 'medium matches without strong', evidence: ['M+', 'M+', 'M+'], verdict: 'suspicious' },
  { name: 'weak mismatches only', evidence: ['W-', 'W-'], verdict: 'suspicious' },
  { name: 'strong matches + medium matches + weak mismatch', evidence: ['S+', 'S+', 'M+', 'W-'], verdict: 'consistent' },
]

describe('verdict rules (table)', () => {
  for (const row of table) {
    it(row.name, () => {
      const s = score(row.evidence.map(e => ev(e)))
      expect(s.verdict).toBe(row.verdict)
      expect(s.confidence).toBeGreaterThan(0)
      expect(s.confidence).toBeLessThan(1)
    })
  }
})

describe('confidence', () => {
  it('never reaches certainty, grows with evidence', () => {
    const many = score(Array.from({ length: 12 }, () => ev('S-')))
    expect(many.confidence).toBeLessThanOrEqual(0.97)
    const one = score([ev('S-')])
    expect(many.confidence).toBeGreaterThan(one.confidence)
    const consistent = score(Array.from({ length: 12 }, () => ev('S+')))
    expect(consistent.confidence).toBeLessThanOrEqual(0.95)
  })

  it('conflicting strong evidence lowers confidence and mentions mixed routing', () => {
    const pure = score([ev('S-')])
    const mixed = score([ev('S-'), ev('S+')])
    expect(mixed.confidence).toBeLessThan(pure.confidence)
    expect(mixed.reasons.join(' ')).toContain('混合路由')
  })

  it('strong evidence in different categories is not treated as mixed routing', () => {
    const s = score([ev('S+', 'substitution'), ev('S-', 'injection')])
    expect(s.verdict).toBe('inconsistent')
    expect(s.confidence).toBe(score([ev('S-', 'injection')]).confidence)
    expect(s.reasons.join(' ')).not.toContain('混合路由')
  })

  it('suspicious lists medium and weak mismatch reasons', () => {
    const s = score([ev('M-'), ev('W-'), ev('M?')])
    expect(s.reasons.some(r => r.startsWith('[中]'))).toBe(true)
    expect(s.reasons.some(r => r.startsWith('[弱]'))).toBe(true)
  })

  it.each([[0.95, '高'], [0.8, '较高'], [0.6, '中等'], [0.3, '低']])('label %s → %s', (c, label) => {
    expect(confidenceLabel(c)).toBe(label)
  })
})

describe('problem categories', () => {
  it.each<[Spec[], string]>([
    [['S-'], 'detected'],
    [['M-'], 'suspected'],
    [['W-'], 'suspected'],
    [['W-', 'M+'], 'not-detected'],
    [['M+'], 'not-detected'],
    [['W?'], 'unknown'],
  ])('%j → %s', (specs, status) => {
    expect(categoryStatus(specs.map(s => ev(s, 'injection')), 'injection').status).toBe(status)
  })

  it('keeps categories separate', () => {
    const s = score([ev('S-', 'injection'), ev('S+', 'substitution'), ev('M+', 'parameters')])
    expect(s.categories.injection.status).toBe('detected')
    expect(s.categories.substitution.status).toBe('not-detected')
    expect(s.categories.parameters.status).toBe('not-detected')
    expect(s.verdict).toBe('inconsistent')
  })
})
