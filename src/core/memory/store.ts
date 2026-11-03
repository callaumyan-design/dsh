/**
 * In-memory long-term memory store with hybrid retrieval.
 *
 * Retrieval score (after Generative Agents, Park et al. 2023):
 *   score = wRel * relevance + wRec * recency + wImp * importance
 * relevance = BM25 (normalised) blended with embedding cosine when vectors exist,
 * recency   = 0.5 ^ (days since last recalled / halfLife)   — a simple forgetting curve,
 * importance= item.importance / 10.
 */
import { clamp, DAY, uid } from '../util'
import { bigramSimilarity, bm25, cosine, normalizeForDedupe } from './text'
import type { MemoryItem, MemoryType, ScoredMemory } from './types'

export interface AddInput {
  text: string
  type?: MemoryType
  importance?: number
  pinned?: boolean
  source?: MemoryItem['source']
}

export interface SearchOptions {
  now: number
  k?: number
  queryEmbedding?: number[]
  embeddingModel?: string
  halfLifeDays?: number
  weights?: { relevance: number; recency: number; importance: number }
  /** Drop results whose relevance is below this (0..1). */
  minRelevance?: number
  includePinned?: boolean
}

export const DEDUPE_THRESHOLD = 0.8

export class MemoryStore {
  private items: MemoryItem[]

  constructor(items: MemoryItem[] = [], private readonly onChange?: (items: MemoryItem[]) => void) {
    this.items = items.filter((i) => i && typeof i.text === 'string').map((i) => normalizeItem(i))
  }

  all(): MemoryItem[] {
    return [...this.items].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
  }

  get size(): number {
    return this.items.length
  }

  get(id: string): MemoryItem | undefined {
    return this.items.find((i) => i.id === id)
  }

  private changed(): void {
    this.onChange?.(this.items)
  }

  /** Find an existing memory that says (almost) the same thing. */
  findDuplicate(text: string): MemoryItem | undefined {
    const norm = normalizeForDedupe(text)
    let best: MemoryItem | undefined
    let bestSim = 0
    for (const item of this.items) {
      if (normalizeForDedupe(item.text) === norm) return item
      const sim = bigramSimilarity(item.text, text)
      if (sim > bestSim) {
        bestSim = sim
        best = item
      }
    }
    return bestSim >= DEDUPE_THRESHOLD ? best : undefined
  }

  add(input: AddInput, now: number): { item: MemoryItem; merged: boolean } {
    const text = input.text.trim()
    if (!text) throw new Error('记忆内容不能为空')
    const dup = this.findDuplicate(text)
    if (dup) {
      const updated = this.update(
        dup.id,
        {
          text: text.length >= dup.text.length ? text : dup.text,
          importance: Math.max(dup.importance, input.importance ?? 0),
          pinned: dup.pinned || !!input.pinned
        },
        now
      )!
      return { item: updated, merged: true }
    }
    const item: MemoryItem = {
      id: uid('m'),
      text,
      type: input.type ?? 'fact',
      importance: clamp(Math.round(input.importance ?? 5), 1, 10),
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      pinned: !!input.pinned,
      source: input.source ?? 'user'
    }
    this.items.push(item)
    this.changed()
    return { item, merged: false }
  }

  update(id: string, patch: Partial<Pick<MemoryItem, 'text' | 'type' | 'importance' | 'pinned'>>, now: number): MemoryItem | undefined {
    const idx = this.items.findIndex((i) => i.id === id)
    if (idx < 0) return undefined
    const prev = this.items[idx]
    const next: MemoryItem = {
      ...prev,
      ...patch,
      text: (patch.text ?? prev.text).trim() || prev.text,
      importance: clamp(Math.round(patch.importance ?? prev.importance), 1, 10),
      updatedAt: now
    }
    if (next.text !== prev.text) {
      delete next.embedding
      delete next.embeddingModel
    }
    this.items[idx] = next
    this.changed()
    return next
  }

  remove(id: string): boolean {
    const before = this.items.length
    this.items = this.items.filter((i) => i.id !== id)
    if (this.items.length !== before) this.changed()
    return this.items.length !== before
  }

  /** Mark memories as recalled: refreshes recency (the forgetting curve resets). */
  touch(ids: string[], now: number): void {
    if (!ids.length) return
    const set = new Set(ids)
    this.items = this.items.map((i) => (set.has(i.id) ? { ...i, lastAccessedAt: now, accessCount: i.accessCount + 1 } : i))
    this.changed()
  }

  setEmbedding(id: string, embedding: number[], model: string): void {
    const it = this.items.find((i) => i.id === id)
    if (!it) return
    it.embedding = embedding
    it.embeddingModel = model
    this.changed()
  }

  needingEmbedding(model: string): MemoryItem[] {
    return this.items.filter((i) => !i.embedding || i.embeddingModel !== model)
  }

  core(limit = 8): MemoryItem[] {
    return this.items
      .filter((i) => i.pinned)
      .sort((a, b) => b.importance - a.importance || b.updatedAt - a.updatedAt)
      .slice(0, limit)
  }

  search(query: string, opts: SearchOptions): ScoredMemory[] {
    const pool = opts.includePinned ? this.items : this.items.filter((i) => !i.pinned)
    if (!pool.length) return []
    const w = opts.weights ?? { relevance: 1, recency: 0.25, importance: 0.35 }
    const halfLife = (opts.halfLifeDays ?? 14) * DAY
    const lexRaw = bm25(query, pool.map((i) => i.text))
    const lexMax = Math.max(...lexRaw, 0)
    const scored = pool.map((item, idx) => {
      const lexical = lexMax > 0 ? lexRaw[idx] / lexMax : 0
      let relevance = lexical
      if (opts.queryEmbedding && item.embedding && (!opts.embeddingModel || item.embeddingModel === opts.embeddingModel)) {
        const sem = Math.max(0, cosine(opts.queryEmbedding, item.embedding))
        relevance = 0.65 * sem + 0.35 * lexical
      }
      const recency = Math.pow(0.5, Math.max(0, opts.now - item.lastAccessedAt) / halfLife)
      const importance = item.importance / 10
      return { item, relevance, recency, importance, score: w.relevance * relevance + w.recency * recency + w.importance * importance }
    })
    const minRel = opts.minRelevance ?? 0.12
    return scored
      .filter((s) => s.relevance >= minRel)
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.k ?? 6)
  }

  /** Replace several memories with one merged memory, keeping the strongest stats. */
  mergeItems(ids: string[], text: string, importance: number | undefined, now: number): MemoryItem | undefined {
    const parts = ids.map((id) => this.get(id)).filter((m): m is MemoryItem => !!m)
    if (parts.length < 2 || !text.trim()) return undefined
    const merged: MemoryItem = {
      id: uid('m'),
      text: text.trim(),
      type: parts[0].type,
      importance: clamp(Math.round(importance ?? Math.max(...parts.map((p) => p.importance))), 1, 10),
      createdAt: Math.min(...parts.map((p) => p.createdAt)),
      updatedAt: now,
      lastAccessedAt: Math.max(...parts.map((p) => p.lastAccessedAt)),
      accessCount: parts.reduce((s, p) => s + p.accessCount, 0),
      pinned: parts.some((p) => p.pinned),
      source: 'auto'
    }
    const drop = new Set(parts.map((p) => p.id))
    this.items = [...this.items.filter((m) => !drop.has(m.id)), merged]
    this.changed()
    return merged
  }

  replaceAll(items: MemoryItem[]): void {
    this.items = items.map(normalizeItem)
    this.changed()
  }

  /** Merge imported memories; duplicates are folded into existing ones. */
  importItems(items: Array<Partial<MemoryItem>>, now: number): { added: number; merged: number } {
    let added = 0
    let merged = 0
    for (const raw of items) {
      if (!raw || typeof raw.text !== 'string' || !raw.text.trim()) continue
      const r = this.add(
        { text: raw.text, type: raw.type, importance: raw.importance, pinned: raw.pinned, source: 'import' },
        raw.createdAt ?? now
      )
      if (r.merged) merged++
      else added++
    }
    return { added, merged }
  }
}

const TYPES: MemoryType[] = ['fact', 'preference', 'event', 'self', 'episode', 'reflection']

function normalizeItem(i: MemoryItem): MemoryItem {
  const now = Date.now()
  return {
    ...i,
    id: i.id || uid('m'),
    type: TYPES.includes(i.type) ? i.type : 'fact',
    importance: clamp(Math.round(i.importance ?? 5), 1, 10),
    createdAt: i.createdAt ?? now,
    updatedAt: i.updatedAt ?? i.createdAt ?? now,
    lastAccessedAt: i.lastAccessedAt ?? i.updatedAt ?? now,
    accessCount: i.accessCount ?? 0,
    pinned: !!i.pinned,
    source: i.source ?? 'user'
  }
}
