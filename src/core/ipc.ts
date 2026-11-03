/** Types shared by main, preload and renderer. No runtime code that touches Node or DOM. */
import type { Emotion } from './ai/emotion'
import type { ProviderConfig } from './ai/types'
import type { ItemDef } from './game/items'
import type { ActionResult, Condition, GameAction, GameState, PetAnimState } from './game/types'
import type { DiaryEntry, MemoryItem, MemoryType, ScoredMemory } from './memory/types'
import type { Persona } from './persona/persona'
import type { ResolvedPack } from './pets/pack'
import type { Settings } from './settings'
import type { Repeat, TasksState } from './tasks'

export interface StoredMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  emotion?: Emotion | null
  ts: number
  /** true for lines the pet said by itself (proactive) or local system notices */
  proactive?: boolean
  error?: boolean
}

export type PublicProvider = ProviderConfig & { hasKey: boolean }

export interface PublicSettings extends Omit<Settings, 'providers'> {
  providers: PublicProvider[]
  embeddingHasOwnKey: boolean
  sttHasOwnKey: boolean
}

export interface Snapshot {
  game: GameState
  conditions: Condition[]
  settings: PublicSettings
  persona: Persona
  packs: ResolvedPack[]
  items: ItemDef[]
  usageToday: { input: number; output: number; requests: number }
  memoryCount: number
  tasks: TasksState
  platform: string
  dataDir: string
  version: string
}

export type MemoryItemPublic = Omit<MemoryItem, 'embedding'> & { hasEmbedding: boolean }
export type ScoredMemoryPublic = Omit<ScoredMemory, 'item'> & { item: MemoryItemPublic }

export interface MotionEvent {
  mode: 'idle' | 'walk' | 'drag' | 'fall'
  dir: 'left' | 'right'
}

export interface PetSayEvent {
  text: string
  emotion?: Emotion | null
  anim?: PetAnimState
  /** ms; 0 = auto from length */
  duration?: number
}

export interface ChatStartEvent { id: string; userText: string }
export interface ChatDeltaEvent { id: string; delta: string; emotion: Emotion | null }
export interface ChatDoneEvent { id: string; message: StoredMessage }
export interface ChatErrorEvent { id: string; message: string }

export interface TestResult { ok: boolean; message: string; latencyMs?: number }

/** Events pushed main -> renderer. */
export interface EventMap {
  'game:update': { game: GameState; conditions: Condition[] }
  'settings:update': PublicSettings
  'persona:update': Persona
  'packs:update': ResolvedPack[]
  'memory:changed': { count: number }
  'chat:start': ChatStartEvent
  'chat:delta': ChatDeltaEvent
  'chat:done': ChatDoneEvent
  'chat:error': ChatErrorEvent
  'pet:motion': MotionEvent
  'pet:say': PetSayEvent
  'pet:anim': { anim: PetAnimState; duration: number }
  'pet:openInput': Record<string, never>
  'tasks:update': TasksState
  'panel:tab': { tab: string }
}

export interface SoulPetAPI {
  getSnapshot(): Promise<Snapshot>
  gameAction(action: GameAction): Promise<Omit<ActionResult, 'state'>>
  chatSend(text: string): Promise<{ ok: boolean; error?: string }>
  chatAbort(): Promise<void>
  chatHistory(limit?: number): Promise<StoredMessage[]>
  chatClear(): Promise<void>

  memoryList(): Promise<MemoryItemPublic[]>
  memorySearch(query: string): Promise<ScoredMemoryPublic[]>
  memoryAdd(input: { text: string; type?: MemoryType; importance?: number; pinned?: boolean }): Promise<MemoryItemPublic>
  memoryUpdate(id: string, patch: Partial<Pick<MemoryItem, 'text' | 'type' | 'importance' | 'pinned'>>): Promise<MemoryItemPublic | null>
  memoryDelete(id: string): Promise<boolean>
  memoryExport(): Promise<string | null>
  memoryImport(): Promise<{ added: number; merged: number } | null>
  memoryConsolidate(): Promise<{ ok: boolean; merged: number; forgotten: number; error?: string }>

  diaryList(): Promise<DiaryEntry[]>
  tasksAddReminder(input: { text: string; dueAt: number; repeat?: Repeat }): Promise<TasksState>
  tasksAddTodo(text: string): Promise<TasksState>
  tasksEdit(op: { kind: 'toggleTodo' | 'deleteTodo' | 'deleteReminder' | 'clearDoneTodos'; id?: string }): Promise<TasksState>
  focusStart(minutes: number, label?: string): Promise<TasksState>
  focusStop(): Promise<TasksState>
  diaryGenerate(date?: string): Promise<{ ok: boolean; entry?: DiaryEntry; error?: string }>

  settingsUpdate(patch: Partial<Settings>): Promise<PublicSettings>
  providerUpsert(cfg: ProviderConfig): Promise<PublicSettings>
  providerRemove(id: string): Promise<PublicSettings>
  setApiKey(target: string, key: string): Promise<PublicSettings>
  testProvider(id: string): Promise<TestResult>
  testEmbedding(): Promise<TestResult>
  sttTranscribe(audio: Uint8Array, mime: string): Promise<{ ok: boolean; text?: string; error?: string }>

  personaUpdate(patch: Partial<Persona>): Promise<Persona>
  personaImportCard(): Promise<{ ok: boolean; persona?: Persona; error?: string }>
  personaReset(): Promise<Persona>

  packsReload(): Promise<ResolvedPack[]>
  packSelect(id: string): Promise<PublicSettings>
  packImport(kind: 'zip' | 'folder'): Promise<{ ok: boolean; packId?: string; name?: string; warnings?: string[]; error?: string }>
  openPacksFolder(): Promise<void>
  openDataFolder(): Promise<void>
  openLogsFolder(): Promise<void>
  openExternal(url: string): Promise<void>

  openPanel(tab?: string): Promise<void>
  completeSetup(): Promise<void>
  diagnostics(): Promise<Record<string, string | number | boolean>>
  checkUpdate(): Promise<{ ok: boolean; latest?: { version: string; url: string; name: string } | null; error?: string }>
  petDragStart(): void
  petDragEnd(): void
  petSetInteractive(interactive: boolean): void
  petContextMenu(): void
  petInputState(open: boolean): void
  petSetSize(width: number, height: number): void

  on<K extends keyof EventMap>(channel: K, cb: (payload: EventMap[K]) => void): () => void
}
