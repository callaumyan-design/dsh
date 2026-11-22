/** Small pure helpers: statistics, text similarity, header shapes, abortable sleep. */

export function median(values: readonly number[]): number | undefined {
  return quantile(values, 0.5)
}

/** Linear-interpolated quantile (type 7). */
export function quantile(values: readonly number[], q: number): number | undefined {
  const sorted = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b)
  if (sorted.length === 0) return undefined
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  const a = sorted[lo] as number
  const b = sorted[hi] as number
  return a + (b - a) * (pos - lo)
}

export interface Summary { n: number; median?: number; q1?: number; q3?: number; min?: number; max?: number }

export function summarize(values: readonly number[]): Summary {
  const finite = values.filter(v => Number.isFinite(v))
  return {
    n: finite.length,
    median: round(median(finite)),
    q1: round(quantile(finite, 0.25)),
    q3: round(quantile(finite, 0.75)),
    min: finite.length ? Math.min(...finite) : undefined,
    max: finite.length ? Math.max(...finite) : undefined,
  }
}

export function round(value: number | undefined, digits = 2): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  const f = 10 ** digits
  return Math.round(value * f) / f
}

/** Character n-gram frequency vector (whitespace collapsed, case-folded). */
export function charNgrams(text: string, n = 3): Map<string, number> {
  const normalized = ` ${text.toLowerCase().replace(/\s+/g, ' ').trim()} `
  const grams = new Map<string, number>()
  const chars = [...normalized]
  if (chars.length < n) {
    if (normalized.trim().length > 0) grams.set(normalized, 1)
    return grams
  }
  for (let i = 0; i + n <= chars.length; i++) {
    const g = chars.slice(i, i + n).join('')
    grams.set(g, (grams.get(g) ?? 0) + 1)
  }
  return grams
}

/** Cosine similarity of character n-gram vectors, in [0, 1]. Two empty texts are identical. */
export function ngramSimilarity(a: string, b: string, n = 3): number {
  const va = charNgrams(a, n)
  const vb = charNgrams(b, n)
  if (va.size === 0 && vb.size === 0) return 1
  if (va.size === 0 || vb.size === 0) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (const [g, c] of va) {
    na += c * c
    const d = vb.get(g)
    if (d !== undefined) dot += c * d
  }
  for (const c of vb.values()) nb += c * c
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/** Mean pairwise similarity of a set of texts (1 for fewer than two). */
export function meanPairwiseSimilarity(texts: readonly string[]): number {
  if (texts.length < 2) return 1
  let total = 0
  let count = 0
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      total += ngramSimilarity(texts[i] as string, texts[j] as string)
      count++
    }
  }
  return total / count
}

/** Mean of the best cross similarity between two sets of texts. */
export function crossSimilarity(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  let total = 0
  let count = 0
  for (const x of a) {
    for (const y of b) {
      total += ngramSimilarity(x, y)
      count++
    }
  }
  return total / count
}

/**
 * Describe a header value by presence and format only — the value itself is
 * never stored. Example: `req_011CVab…` → `req_ + [0-9A-Za-z]{24}`.
 */
export function describeFormat(value: string): string {
  const v = value.trim()
  if (v === '') return 'empty'
  if (/^\d+$/.test(v)) return `integer(${v.length} digits)`
  if (/^\d+(\.\d+)?$/.test(v)) return 'decimal'
  if (/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(v)) return 'http-date'
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return 'uuid'
  const prefix = /^([A-Za-z]{2,10}[_-])(?=[A-Za-z0-9])/.exec(v)?.[1] ?? ''
  const rest = v.slice(prefix.length)
  if (rest.length > 0 && /^[A-Za-z0-9_-]+$/.test(rest)) return `${prefix ? `${prefix} + ` : ''}${charClass(rest)}{${rest.length}}`
  return `text(${v.length} chars)`
}

/** Character class summary of a token-like string, e.g. `[0-9a-f]` or `[0-9A-Za-z]`. */
export function charClass(s: string): string {
  if (/^[0-9a-f]+$/.test(s)) return '[0-9a-f]'
  if (/^[0-9A-F]+$/.test(s)) return '[0-9A-F]'
  const parts: string[] = []
  if (/\d/.test(s)) parts.push('0-9')
  if (/[A-Z]/.test(s)) parts.push('A-Z')
  if (/[a-z]/.test(s)) parts.push('a-z')
  if (/_/.test(s)) parts.push('_')
  if (/-/.test(s)) parts.push('-')
  return `[${parts.join('')}]`
}

/** Pattern of an id: prefix + char class, length bucketed (used to compare id shapes across endpoints). */
export function idPattern(id: string | undefined): string | undefined {
  if (id === undefined || id === '') return undefined
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return 'uuid'
  const m = /^([A-Za-z]+[_-])(.*)$/.exec(id)
  const prefix = m?.[1] ?? ''
  const rest = m?.[2] ?? id
  return `${prefix}${charClass(rest)}`
}

export class AbortedError extends Error {
  constructor(message = 'aborted') { super(message); this.name = 'AbortError' }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new AbortedError()); return }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve() }, Math.max(0, ms))
    const onAbort = (): void => { clearTimeout(timer); reject(new AbortedError()) }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Safe file/dir name fragment. */
export function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'model'
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
