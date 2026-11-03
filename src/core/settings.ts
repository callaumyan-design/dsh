import { defaultProviders } from './ai/providers'
import type { ProviderConfig } from './ai/types'
import type { Difficulty } from './game/types'
import { BUILTIN_PACK_ID } from './pets/pack'
import type { ProactiveSettings } from './proactive'

export type BlobAccessory = 'none' | 'bow' | 'leaf' | 'crown' | 'glasses' | 'cat-ears'

export interface Settings {
  version: 1
  providers: ProviderConfig[]
  activeProviderId: string
  /** Provider for background memory/diary jobs; '' = same as chat. Pick a cheap one to save money. */
  memoryProviderId: string
  embedding: {
    enabled: boolean
    baseURL: string
    model: string
    /** Reuse the API key of this provider id, or 'own' to use a separate key. */
    keyFrom: string
  }
  memory: {
    autoExtract: boolean
    maxRetrieved: number
    maxCore: number
    dailyDiary: boolean
  }
  chat: {
    historyChars: number
    /** 0 = unlimited */
    dailyTokenLimit: number
  }
  proactive: ProactiveSettings
  game: { difficulty: Difficulty; maxOfflineHours: number }
  appearance: {
    packId: string
    scale: number
    walkEnabled: boolean
    blobColor: string
    blobAccessory: BlobAccessory
    opacity: number
  }
  app: { autoStart: boolean; dnd: boolean; hotkey: string; hideHotkey: string; alwaysOnTop: boolean; clickThrough: boolean; proxy: string; checkUpdates: boolean; hideOnFullscreen: boolean }
  voice: { enabled: boolean; voiceName: string; rate: number; pitch: number; volume: number }
  /** speech-to-text; keyFrom = provider id whose key to reuse, or 'own' */
  stt: { enabled: boolean; baseURL: string; model: string; keyFrom: string; language: string }
  weather: { enabled: boolean; city: string }
  window: { x: number | null; y: number | null }
  /** greeting shown */
  onboarded: boolean
  /** first-run wizard finished */
  setupDone: boolean
}

export function defaultSettings(): Settings {
  return {
    version: 1,
    providers: defaultProviders(),
    activeProviderId: 'deepseek',
    memoryProviderId: '',
    embedding: { enabled: false, baseURL: 'https://api.siliconflow.cn/v1', model: 'BAAI/bge-m3', keyFrom: 'own' },
    memory: { autoExtract: true, maxRetrieved: 6, maxCore: 8, dailyDiary: true },
    chat: { historyChars: 6000, dailyTokenLimit: 0 },
    proactive: { level: 'medium', quietEnabled: true, quietStart: '23:00', quietEnd: '08:00', useAI: false },
    game: { difficulty: 'normal', maxOfflineHours: 12 },
    appearance: { packId: BUILTIN_PACK_ID, scale: 1, walkEnabled: true, blobColor: '#8fd3ff', blobAccessory: 'bow', opacity: 1 },
    app: { autoStart: false, dnd: false, hotkey: 'CommandOrControl+Alt+P', hideHotkey: 'CommandOrControl+Alt+H', alwaysOnTop: true, clickThrough: false, proxy: '', checkUpdates: true, hideOnFullscreen: true },
    voice: { enabled: false, voiceName: '', rate: 1.1, pitch: 1.3, volume: 0.9 },
    stt: { enabled: false, baseURL: 'https://api.siliconflow.cn/v1', model: 'FunAudioLLM/SenseVoiceSmall', keyFrom: 'siliconflow', language: '' },
    weather: { enabled: false, city: '' },
    window: { x: null, y: null },
    onboarded: false,
    setupDone: false
  }
}

type Plain = Record<string, unknown>
const isPlain = (v: unknown): v is Plain => !!v && typeof v === 'object' && !Array.isArray(v)

/** Deep-merge `patch` into `base`. Arrays and primitives replace; objects merge. */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlain(base) || !isPlain(patch)) return (patch === undefined ? base : (patch as T))
  const out: Plain = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    out[k] = isPlain(out[k]) && isPlain(v) ? deepMerge(out[k], v) : v
  }
  return out as T
}

/** Load-time normalisation: merge defaults, keep user providers, append newly shipped presets. */
export function normalizeSettings(raw: unknown): Settings {
  const d = defaultSettings()
  const s = deepMerge(d, isPlain(raw) ? raw : {})
  const userProviders = Array.isArray(s.providers) ? s.providers.filter((p) => p && typeof p.id === 'string') : []
  const ids = new Set(userProviders.map((p) => p.id))
  s.providers = [...userProviders, ...d.providers.filter((p) => !ids.has(p.id))]
  if (!s.providers.some((p) => p.id === s.activeProviderId)) s.activeProviderId = s.providers[0]?.id ?? 'deepseek'
  s.appearance.scale = Math.min(2, Math.max(0.5, Number(s.appearance.scale) || 1))
  s.appearance.opacity = Math.min(1, Math.max(0.2, Number(s.appearance.opacity) || 1))
  s.version = 1
  return s
}
