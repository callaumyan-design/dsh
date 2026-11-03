/**
 * Tokenizer + BM25 that work for Chinese without a dictionary:
 * Han runs become unigrams + bigrams, latin/digit runs become words.
 */

const HAN = /\p{Script=Han}/u
const STOP_HAN = new Set('的了是我你他她它们吗呢吧啊呀在和就都也很这那有个说要会还把被让给对着过'.split(''))
const STOP_EN = new Set(['the', 'a', 'an', 'is', 'are', 'to', 'of', 'and', 'or', 'in', 'on', 'it', 'i', 'you', 'me', 'my', 'do', 'be'])

export function tokenize(text: string): string[] {
  const tokens: string[] = []
  for (const m of text.toLowerCase().matchAll(/[\p{Script=Han}]+|[a-z0-9]+/gu)) {
    const run = m[0]
    if (HAN.test(run[0])) {
      const chars = [...run]
      for (let i = 0; i < chars.length; i++) {
        if (!STOP_HAN.has(chars[i])) tokens.push(chars[i])
        if (i + 1 < chars.length) tokens.push(chars[i] + chars[i + 1])
      }
    } else if (!STOP_EN.has(run) && (run.length > 1 || /\d/.test(run))) {
      tokens.push(run)
    }
  }
  return tokens
}

/** BM25 scores of `query` against each document (same order). */
export function bm25(query: string, docs: string[], k1 = 1.2, b = 0.75): number[] {
  const q = [...new Set(tokenize(query))]
  if (!q.length || !docs.length) return docs.map(() => 0)
  const tokenized = docs.map(tokenize)
  const avgdl = tokenized.reduce((s, t) => s + t.length, 0) / tokenized.length || 1
  const df = new Map<string, number>()
  for (const toks of tokenized) for (const t of new Set(toks)) df.set(t, (df.get(t) ?? 0) + 1)
  const N = docs.length
  return tokenized.map((toks) => {
    const tf = new Map<string, number>()
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1)
    let score = 0
    for (const term of q) {
      const f = tf.get(term)
      if (!f) continue
      const n = df.get(term) ?? 0
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5))
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * toks.length) / avgdl)))
    }
    return score
  })
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

/** Normalise for duplicate detection: drop punctuation/whitespace, lowercase. */
export function normalizeForDedupe(s: string): string {
  return s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

/** Jaccard similarity of character bigrams, robust for short Chinese sentences. */
export function bigramSimilarity(a: string, b: string): number {
  const grams = (s: string) => {
    const n = [...normalizeForDedupe(s)]
    const set = new Set<string>()
    for (let i = 0; i + 1 < n.length; i++) set.add(n[i] + n[i + 1])
    if (n.length === 1) set.add(n[0])
    return set
  }
  const A = grams(a)
  const B = grams(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const g of A) if (B.has(g)) inter++
  return inter / (A.size + B.size - inter)
}
