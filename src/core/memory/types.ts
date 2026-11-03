export type MemoryType = 'fact' | 'preference' | 'event' | 'self' | 'episode' | 'reflection'

export const MEMORY_TYPE_LABEL: Record<MemoryType, string> = {
  fact: '事实',
  preference: '喜好',
  event: '事件',
  self: '关于自己',
  episode: '对话摘要',
  reflection: '感悟'
}

export interface MemoryItem {
  id: string
  text: string
  type: MemoryType
  /** 1 (trivial) .. 10 (core) */
  importance: number
  createdAt: number
  updatedAt: number
  lastAccessedAt: number
  accessCount: number
  /** Pinned memories are always in context ("core memory"). */
  pinned: boolean
  source: 'auto' | 'user' | 'explicit' | 'diary' | 'import'
  embedding?: number[]
  embeddingModel?: string
}

export interface ScoredMemory {
  item: MemoryItem
  score: number
  relevance: number
  recency: number
  importance: number
}

export interface DiaryEntry {
  date: string
  text: string
  insights: string[]
  createdAt: number
}
