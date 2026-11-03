export type StatKey = 'satiety' | 'mood' | 'energy' | 'cleanliness' | 'health'
export type Stats = Record<StatKey, number>
export type Difficulty = 'casual' | 'normal' | 'hard'
export type Stage = 'baby' | 'child' | 'adult'

/** Semantic animation states. Pet packs map these to their own assets, with fallbacks. */
export type PetAnimState =
  | 'idle'
  | 'walk'
  | 'walk_left'
  | 'drag'
  | 'fall'
  | 'sleep'
  | 'eat'
  | 'happy'
  | 'sad'
  | 'angry'
  | 'surprised'
  | 'shy'
  | 'think'
  | 'talk'
  | 'work'
  | 'sick'
  | 'play'
  | 'bath'
  | 'wave'
  | 'jump'

export interface GameState {
  version: 1
  createdAt: number
  lastTick: number
  stats: Stats
  affection: number
  exp: number
  level: number
  coins: number
  inventory: Record<string, number>
  asleep: boolean
  lastCheckIn: string | null
  checkInStreak: number
  /** action name -> timestamp (ms) when it becomes available again */
  cooldowns: Record<string, number>
  daily: { date: string; affectionFromChat: number; affectionFromPet: number }
  totals: { fed: number; played: number; worked: number; studied: number; chats: number; baths: number; pets: number }
  lastPetAt: number
}

export type GameAction =
  | { type: 'pet' }
  | { type: 'play' }
  | { type: 'bath' }
  | { type: 'sleep' }
  | { type: 'wake' }
  | { type: 'work' }
  | { type: 'study' }
  | { type: 'use'; itemId: string }
  | { type: 'feed'; itemId: string }
  | { type: 'buy'; itemId: string; count?: number }
  | { type: 'checkIn' }
  | { type: 'chat' }

export type Delta = Partial<Record<StatKey | 'affection' | 'exp' | 'coins', number>>

export interface ActionResult {
  ok: boolean
  state: GameState
  message: string
  anim?: PetAnimState
  delta: Delta
  leveledUp?: number
}

export type Condition =
  | 'sick'
  | 'starving'
  | 'hungry'
  | 'exhausted'
  | 'tired'
  | 'dirty'
  | 'sad'
  | 'happy'
  | 'content'
