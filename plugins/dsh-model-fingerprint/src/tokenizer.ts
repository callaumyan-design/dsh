/** Fixed differential-tokenizer corpus and local tiktoken counting. */
import type { Tiktoken } from 'js-tiktoken/lite'

/** Bump when the corpus text changes; baselines record it and are only compared on equality. */
export const CORPUS_VERSION = 'v1'

/** The minimal prompt every tokenizer request starts with. */
export const MINIMAL_PROMPT = 'Reply with OK.'
/** Separator between the minimal prompt and a corpus segment. */
export const SEGMENT_SEPARATOR = '\n\n'

export interface CorpusSegment { id: string; label: string; text: string }

/**
 * Segments chosen to separate tokenizers: different vendors' BPE / unigram
 * vocabularies split CJK, emoji ZWJ sequences, rare scripts, long digit
 * runs and whitespace very differently.
 */
export const CORPUS: readonly CorpusSegment[] = [
  { id: 'en', label: '英文', text: 'The quick brown fox jumps over the lazy dog while the committee deliberates on quarterly budget allocations and infrastructure resilience.' },
  { id: 'zh', label: '中文', text: '人工智能模型的分词器在处理中文文本时会表现出显著差异，例如成语「龍飛鳳舞」、全角标点以及繁體字的切分方式。' },
  { id: 'ja_ko', label: '日文/韩文', text: '東京で寿司を食べました。서울에서 비빔밥을 먹었어요.' },
  { id: 'code', label: '代码', text: 'def fib(n: int) -> int:\n    return n if n < 2 else fib(n - 1) + fib(n - 2)\n\nconsole.log([1, 2, 3].map(x => x ** 2).filter(Boolean));' },
  { id: 'emoji', label: 'emoji', text: '🚀🔥 Launch day! 👩‍💻👨‍👩‍👧‍👦 🏳️‍🌈 🇯🇵🇨🇳 ✅❌ 🤖💬 ⚡️' },
  { id: 'rare_unicode', label: '罕见 Unicode', text: 'Ꙭ ꧁꧂ 𓀀𓂀 ∮ E⋅da = Q ⅋ ℵ₀ ⟨ψ|φ⟩ 𝔉𝔯𝔞𝔨𝔱𝔲𝔯 ǅ ᚠᛇᚻ' },
  { id: 'digits', label: '长数字', text: '3141592653589793238462643383279502884197 0.000000001234 18446744073709551615 2026-11-22T16:50:28+08:00' },
  { id: 'whitespace', label: '空白组合', text: 'a\t\tb   c\n\n\n    d   e\r\n\tf          g\n' },
  { id: 'mixed', label: '混合', text: "SELECT * FROM users WHERE name = 'José Müller' AND city = 'Zürich'; -- ñandú café naïve" },
]

export function segmentPrompt(segment: CorpusSegment): string {
  return `${MINIMAL_PROMPT}${SEGMENT_SEPARATOR}${segment.text}`
}

const encoders = new Map<string, Promise<Tiktoken>>()

/** Lazily load a tiktoken encoder (ranks are bundled as separate chunks). */
export function loadEncoder(name: 'o200k_base' | 'cl100k_base'): Promise<Tiktoken> {
  let pending = encoders.get(name)
  if (!pending) {
    pending = (async () => {
      const { Tiktoken } = await import('js-tiktoken/lite')
      const ranks = name === 'o200k_base'
        ? (await import('js-tiktoken/ranks/o200k_base')).default
        : (await import('js-tiktoken/ranks/cl100k_base')).default
      return new Tiktoken(ranks)
    })()
    encoders.set(name, pending)
  }
  return pending
}

export async function countTiktoken(name: 'o200k_base' | 'cl100k_base', text: string): Promise<number> {
  const enc = await loadEncoder(name)
  return enc.encode(text, 'all').length
}

/** Expected Δ for one segment under a local encoder: |enc(minimal+sep+segment)| − |enc(minimal)|. */
export async function tiktokenDelta(name: 'o200k_base' | 'cl100k_base', segment: CorpusSegment): Promise<number> {
  return await countTiktoken(name, segmentPrompt(segment)) - await countTiktoken(name, MINIMAL_PROMPT)
}

/**
 * Chat Completions framing for one user message under OpenAI's documented
 * accounting: 3 tokens per message + role + content, plus 3 reply-priming
 * tokens. An estimate only (used when neither a reference nor a baseline exists).
 */
export async function estimateChatPromptTokens(name: 'o200k_base' | 'cl100k_base', userText: string): Promise<number> {
  return 3 + await countTiktoken(name, 'user') + await countTiktoken(name, userText) + 3
}

/** Is `token` a single token of this encoding? (Used to check logprob token streams.) */
export async function isSingleToken(name: 'o200k_base' | 'cl100k_base', token: string): Promise<boolean> {
  const enc = await loadEncoder(name)
  return enc.encode(token, 'all').length === 1
}

export interface DeltaComparison {
  segment: string
  observed: number
  expected: number
  diff: number
  verdict: 'match' | 'near' | 'mismatch'
}

/** Per-segment tolerance: exact ±max(1, 3%) is a match, beyond ±max(3, 15%) a mismatch. */
export function compareDelta(segment: string, observed: number, expected: number): DeltaComparison {
  const diff = observed - expected
  const abs = Math.abs(diff)
  const verdict = abs <= Math.max(1, 0.03 * expected) ? 'match' : abs > Math.max(3, 0.15 * expected) ? 'mismatch' : 'near'
  return { segment, observed, expected, diff, verdict }
}
