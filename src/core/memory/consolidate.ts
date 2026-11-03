/**
 * Memory consolidation ("dreaming"): periodically group similar memories and let the LLM
 * merge each group into fewer, cleaner statements; also forget trivial memories that have
 * not been recalled for a long time. Pinned memories are never touched.
 */
import { extractJson } from '../ai/client'
import type { ChatMessage } from '../ai/types'
import { DAY } from '../util'
import type { MemoryStore } from './store'
import { bigramSimilarity, cosine } from './text'
import type { MemoryItem } from './types'

export interface ClusterOptions {
  lexicalThreshold?: number
  semanticThreshold?: number
  maxClusters?: number
  maxClusterSize?: number
}

/** Union-find clusters of similar, non-pinned memories (size >= 2). */
export function findClusters(items: MemoryItem[], opts: ClusterOptions = {}): MemoryItem[][] {
  const lex = opts.lexicalThreshold ?? 0.42
  const sem = opts.semanticThreshold ?? 0.88
  const pool = items.filter((m) => !m.pinned && m.type !== 'episode')
  const parent = pool.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i]
      const b = pool[j]
      const similar =
        bigramSimilarity(a.text, b.text) >= lex ||
        (!!a.embedding && !!b.embedding && a.embeddingModel === b.embeddingModel && cosine(a.embedding, b.embedding) >= sem)
      if (similar) parent[find(i)] = find(j)
    }
  }
  const groups = new Map<number, MemoryItem[]>()
  pool.forEach((m, i) => {
    const r = find(i)
    groups.set(r, [...(groups.get(r) ?? []), m])
  })
  return [...groups.values()]
    .filter((g) => g.length >= 2)
    .map((g) => g.sort((a, b) => b.importance - a.importance).slice(0, opts.maxClusterSize ?? 6))
    .sort((a, b) => b.length - a.length)
    .slice(0, opts.maxClusters ?? 5)
}

export function buildConsolidationMessages(petName: string, clusters: MemoryItem[][]): ChatMessage[] {
  const body = clusters
    .map((c, i) => `第 ${i + 1} 组：\n${c.map((m) => `- ${m.id}（重要度 ${m.importance}）：${m.text}`).join('\n')}`)
    .join('\n\n')
  return [
    {
      role: 'system',
      content: `你在帮桌宠「${petName}」整理它的长期记忆。下面每一组是内容相近的记忆。
对每一组：如果它们说的是同一件事、或者可以合并成更清楚的一句话，就合并；如果新旧信息矛盾，保留较新的那条的意思；如果其实是不同的事，就不要动。
合并后的句子用第三人称（“用户……”），保留具体细节（名字、日期、数字），一句话说清楚。
只输出 JSON：{"merges":[{"ids":["m_a","m_b"],"text":"合并后的记忆","importance":7}]}
不需要合并的组不要出现在结果里。`
    },
    { role: 'user', content: body }
  ]
}

export interface MergeOp {
  ids: string[]
  text: string
  importance?: number
}

export function parseMerges(text: string): MergeOp[] {
  const j = extractJson<{ merges?: unknown[] }>(text)
  if (!j || !Array.isArray(j.merges)) return []
  const out: MergeOp[] = []
  for (const raw of j.merges) {
    const m = raw as Record<string, unknown>
    if (!m || !Array.isArray(m.ids) || typeof m.text !== 'string' || !m.text.trim()) continue
    const ids = m.ids.filter((x): x is string => typeof x === 'string')
    if (ids.length < 2) continue
    out.push({ ids, text: m.text.trim(), importance: typeof m.importance === 'number' ? m.importance : undefined })
  }
  return out
}

/** Apply merges; every merge must stay inside one of the proposed clusters. */
export function applyMerges(store: MemoryStore, merges: MergeOp[], clusters: MemoryItem[][], now: number): number {
  let merged = 0
  for (const op of merges) {
    const cluster = clusters.find((c) => op.ids.every((id) => c.some((m) => m.id === id)))
    if (!cluster) continue
    if (store.mergeItems(op.ids, op.text, op.importance, now)) merged++
  }
  return merged
}

/** Forget trivial memories nobody has thought about for a long time. */
export function forgettable(items: MemoryItem[], now: number, days = 90): MemoryItem[] {
  return items.filter((m) => !m.pinned && m.importance <= 2 && now - m.lastAccessedAt > days * DAY)
}
