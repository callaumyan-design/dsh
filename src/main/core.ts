/**
 * AppCore owns all persistent state and the background services (chat, memory extraction,
 * embeddings, diary, proactive talk, game clock). Windows/IPC are thin layers on top.
 */
import fs from 'node:fs'
import path from 'node:path'
import { chat } from '../core/ai/client'
import { EMOTION_ANIM, EmotionStreamParser, stripEmotionTags, type Emotion } from '../core/ai/emotion'
import { embedOpenAI } from '../core/ai/openai'
import { transcribe } from '../core/ai/stt'
import { buildAvatarPrompt, generateImage } from '../core/pets/imagegen'
import { buildChatMessages, buildSystemPrompt } from '../core/ai/prompt'
import type { ChatMessage, FetchLike, ProviderConfig } from '../core/ai/types'
import { applyAction, conditions, createGame, describeForPrompt, normalizeGame, tick } from '../core/game/engine'
import { checkAchievements, rollRandomEvent } from '../core/game/achievements'
import { getItem } from '../core/game/items'
import type { ActionResult, GameAction, GameState } from '../core/game/types'
import type { EventMap, MemoryItemPublic, PublicSettings, StoredMessage, TestResult } from '../core/ipc'
import { applyMerges, buildConsolidationMessages, findClusters, forgettable, parseMerges } from '../core/memory/consolidate'
import { buildDiaryMessages, parseDiary } from '../core/memory/diary'
import { applyMemoryOps, buildExtractionMessages, detectExplicitRemember, parseMemoryOps, toThirdPerson, worthExtracting } from '../core/memory/extract'
import { MemoryStore } from '../core/memory/store'
import type { DiaryEntry, MemoryItem } from '../core/memory/types'
import { normalizePersona, type Persona } from '../core/persona/persona'
import {
  decideProactive,
  freshProactiveState,
  proactiveLine,
  recordProactive,
  type ProactiveKind,
  type ProactiveState
} from '../core/proactive'
import { deepMerge, normalizeSettings, type DeepPartial, type Settings } from '../core/settings'
import {
  addReminder,
  addTodo,
  describeDue,
  describeTasksForPrompt,
  fireDue,
  normalizeTasks,
  parseActionTags,
  type Repeat,
  type TasksState
} from '../core/tasks'
import { describeSpecialDays, specialGreeting } from '../core/calendar'
import { describeWeather, parseWttr, weatherUrl, type Weather } from '../core/weather'
import { dateKey, inTimeWindow, previousDateKey, uid } from '../core/util'
import { Secrets } from './secrets'
import { ChatLog, JsonFile } from './storage'

export const EMBEDDING_SECRET = '__embedding__'
export const STT_SECRET = '__stt__'
export const IMAGE_SECRET = '__image__'

type Broadcast = <K extends keyof EventMap>(channel: K, payload: EventMap[K]) => void

interface UsageDay { input: number; output: number; requests: number }
interface Activity { ts: number; text: string }
interface RuntimeState { proactive: ProactiveState; lastDiaryCheck: string | null; lastDreamAt: number; lastEventAt: number; lastSpecial: string; diaryTries: { date: string; n: number } }

export interface CoreOptions {
  dataDir: string
  fetch: FetchLike
  broadcast: Broadcast
  systemIdleSeconds: () => number
}

const ACTION_LABEL: Record<GameAction['type'], string> = {
  pet: '摸了摸它', play: '一起玩耍', bath: '洗澡', sleep: '哄它睡觉', wake: '叫醒它', work: '去打工', study: '去学习',
  use: '使用物品', feed: '喂食', buy: '购物', checkIn: '签到', chat: '聊天', focus: '一起专注'
}

export class AppCore {
  readonly settings: JsonFile<Settings>
  readonly secrets: Secrets
  readonly game: JsonFile<GameState>
  readonly persona: JsonFile<Persona>
  readonly memoryFile: JsonFile<MemoryItem[]>
  readonly memory: MemoryStore
  readonly diary: JsonFile<DiaryEntry[]>
  readonly usage: JsonFile<Record<string, UsageDay>>
  readonly activity: JsonFile<Activity[]>
  readonly runtime: JsonFile<RuntimeState>
  readonly tasks: JsonFile<TasksState>
  /** Notify the OS (set by the window layer). */
  notify: (title: string, body: string) => void = () => {}
  readonly chatLog: ChatLog

  private chatAbort: AbortController | null = null
  private memoryQueue: Promise<void> = Promise.resolve()
  private timers: NodeJS.Timeout[] = []
  private lastIdleSec = 0
  lastPetInteractionAt = Date.now()
  /** set by the window layer while a fullscreen app hides the pet */
  fullscreenActive = false
  weather: Weather | null = null
  /** Set by the window layer so a reply can pause/unpause walking. */
  onChatBusy: (busy: boolean) => void = () => {}

  constructor(private readonly opts: CoreOptions) {
    const f = (name: string) => path.join(opts.dataDir, name)
    const now = Date.now()
    fs.mkdirSync(opts.dataDir, { recursive: true })
    this.settings = new JsonFile(f('settings.json'), normalizeSettings)
    this.secrets = new Secrets(f('secrets.json'))
    this.game = new JsonFile(f('game.json'), (raw) => (raw ? normalizeGame(raw as GameState, now) : createGame(now)))
    this.persona = new JsonFile(f('persona.json'), (raw) => normalizePersona(raw as Persona))
    this.memoryFile = new JsonFile(f('memory.json'), (raw) => (Array.isArray(raw) ? (raw as MemoryItem[]) : []))
    this.memory = new MemoryStore(this.memoryFile.data, (items, kind) => {
      this.memoryFile.set([...items])
      if (kind === 'content') this.opts.broadcast('memory:changed', { count: items.length })
    })
    this.diary = new JsonFile(f('diary.json'), (raw) => (Array.isArray(raw) ? (raw as DiaryEntry[]) : []))
    this.usage = new JsonFile(f('usage.json'), (raw) => (raw && typeof raw === 'object' ? (raw as Record<string, UsageDay>) : {}))
    this.activity = new JsonFile(f('activity.json'), (raw) => (Array.isArray(raw) ? (raw as Activity[]) : []))
    this.runtime = new JsonFile(f('runtime.json'), (raw) => {
      const r = (raw ?? {}) as Partial<RuntimeState>
      return { proactive: r.proactive ?? freshProactiveState(now), lastDiaryCheck: r.lastDiaryCheck ?? null, lastDreamAt: r.lastDreamAt ?? 0, lastEventAt: r.lastEventAt ?? 0, lastSpecial: r.lastSpecial ?? '', diaryTries: r.diaryTries ?? { date: '', n: 0 } }
    })
    this.chatLog = new ChatLog(f('chat'))
    this.tasks = new JsonFile(f('tasks.json'), normalizeTasks)

    // Catch up on time spent closed (gentle, capped).
    const s = this.settings.data
    this.game.set(tick(this.game.data, now, { offline: true, difficulty: s.game.difficulty, maxOfflineHours: s.game.maxOfflineHours }))
  }

  get dataDir(): string {
    return this.opts.dataDir
  }

  // ---------------------------------------------------------------- lifecycle

  start(): void {
    this.timers.push(setInterval(() => this.clockTick(), 60_000))
    this.timers.push(setInterval(() => this.taskTick(), 15_000))
    setTimeout(() => this.taskTick(), 3000)
    this.timers.push(setInterval(() => void this.proactiveTick(), 60_000))
    this.timers.push(setInterval(() => void this.diaryTick(), 30 * 60_000))
    setTimeout(() => void this.diaryTick(), 15_000)
    setTimeout(() => void this.embedPending(), 5_000)
    setTimeout(() => void this.refreshWeather(), 8_000)
    this.timers.push(setInterval(() => void this.refreshWeather(), 90 * 60_000))
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t)
    this.chatAbort?.abort()
    this.flushAll()
  }

  flushAll(): void {
    for (const f of [this.settings, this.game, this.persona, this.memoryFile, this.diary, this.usage, this.activity, this.runtime, this.tasks]) f.flush()
    this.secrets.flush()
  }

  private clockTick(): void {
    const s = this.settings.data
    let g = tick(this.game.data, Date.now(), { difficulty: s.game.difficulty })
    // Nap while the user is away for a long time; wake up when they return.
    const idle = this.opts.systemIdleSeconds()
    if (!g.asleep && idle > 30 * 60 && g.stats.energy < 70) g = { ...g, asleep: true }
    this.setGame(g)
    this.maybeRandomEvent(idle)
  }

  /** Small surprises every now and then (only while the user is at the computer). */
  private maybeRandomEvent(idleSec: number): void {
    const now = Date.now()
    if (idleSec > 300 || this.focusActive() || this.fullscreenActive || this.settings.data.app.dnd || this.chatAbort) return
    if (now - this.runtime.data.lastEventAt < 40 * 60_000) return
    const ev = rollRandomEvent(this.game.data)
    if (!ev) return
    this.runtime.update((r) => ({ ...r, lastEventAt: now }))
    this.setGame(ev.state)
    this.logActivity(ev.text)
    this.say(ev.text, { emotion: ev.id === 'dream' ? 'sleepy' : 'happy', proactive: true })
  }

  private setGame(g: GameState): void {
    const { state, unlocked } = checkAchievements(g, { now: Date.now(), memoryCount: this.memory?.size ?? 0 })
    this.game.set(state)
    this.opts.broadcast('game:update', { game: state, conditions: conditions(state) })
    for (const a of unlocked) {
      const text = `🏆 解锁成就「${a.name}」：${a.desc}${a.reward ? `，奖励 ${a.reward} 金币` : ''}！`
      this.logActivity(text)
      this.say(text, { emotion: 'excited', proactive: true })
    }
  }

  // ---------------------------------------------------------------- settings / providers

  publicSettings(): PublicSettings {
    const s = this.settings.data
    return {
      ...s,
      providers: s.providers.map((p) => ({ ...p, hasKey: this.secrets.has(p.id) })),
      embeddingHasOwnKey: this.secrets.has(EMBEDDING_SECRET),
      sttHasOwnKey: this.secrets.has(STT_SECRET),
      imageHasOwnKey: this.secrets.has(IMAGE_SECRET)
    }
  }

  /** The pet moves often: persist its position without a settings broadcast. */
  saveWindowPosition(p: { x: number; y: number; w: number; h: number; flipped: boolean }): void {
    this.settings.data.window = { x: Math.round(p.x), y: Math.round(p.y), w: Math.round(p.w), h: Math.round(p.h), flipped: !!p.flipped }
    this.settings.scheduleSave(2000)
  }

  updateSettings(patch: DeepPartial<Settings>): PublicSettings {
    // Arrays (providers) are replaced wholesale by deepMerge; normalize re-adds any missing preset.
    const next = normalizeSettings(deepMerge(this.settings.data, patch))
    this.settings.set(next)
    const pub = this.publicSettings()
    this.opts.broadcast('settings:update', pub)
    return pub
  }

  provider(id?: string): ProviderConfig | undefined {
    const s = this.settings.data
    return s.providers.find((p) => p.id === (id || s.activeProviderId))
  }

  private memoryProvider(): ProviderConfig | undefined {
    const s = this.settings.data
    return this.provider(s.memoryProviderId || s.activeProviderId)
  }

  private keyFor(p: ProviderConfig): string {
    return this.secrets.get(p.id)
  }

  private ready(p: ProviderConfig | undefined): p is ProviderConfig {
    return !!p && !!p.model && !!p.baseURL && (p.noKey || this.secrets.has(p.id))
  }

  private recordUsage(input: number, output: number): void {
    const today = dateKey(Date.now())
    this.usage.update((u) => {
      const d = u[today] ?? { input: 0, output: 0, requests: 0 }
      const next = { ...u, [today]: { input: d.input + input, output: d.output + output, requests: d.requests + 1 } }
      const keys = Object.keys(next).sort()
      for (const k of keys.slice(0, Math.max(0, keys.length - 60))) delete next[k]
      return next
    })
  }

  usageToday(): UsageDay {
    return this.usage.data[dateKey(Date.now())] ?? { input: 0, output: 0, requests: 0 }
  }

  private overBudget(): boolean {
    const limit = this.settings.data.chat.dailyTokenLimit
    if (!limit) return false
    const u = this.usageToday()
    return u.input + u.output >= limit
  }

  async testProvider(id: string): Promise<TestResult> {
    const p = this.provider(id)
    if (!p) return { ok: false, message: '找不到这个服务商' }
    if (!p.noKey && !this.secrets.has(p.id)) return { ok: false, message: '还没有填写 API Key' }
    const t0 = Date.now()
    try {
      const r = await chat(p, [{ role: 'user', content: '只回复两个字：在的' }], {
        apiKey: this.keyFor(p),
        fetch: this.opts.fetch,
        maxTokens: p.kind === 'anthropic' ? 2000 : 20,
        signal: AbortSignal.timeout(30_000)
      })
      this.recordUsage(r.usage.inputTokens, r.usage.outputTokens)
      return { ok: true, message: `连接成功：${r.text.slice(0, 40) || '（空回复）'}`, latencyMs: Date.now() - t0 }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  }

  // ---------------------------------------------------------------- embeddings

  private embeddingKey(): string {
    const e = this.settings.data.embedding
    return e.keyFrom === 'own' ? this.secrets.get(EMBEDDING_SECRET) : this.secrets.get(e.keyFrom)
  }

  async embed(texts: string[], timeoutMs = 15_000): Promise<number[][] | null> {
    const e = this.settings.data.embedding
    if (!e.enabled || !texts.length) return null
    const key = this.embeddingKey()
    const f: FetchLike = (url, init) => this.opts.fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
    return embedOpenAI({ baseURL: e.baseURL, model: e.model }, texts, key, f)
  }

  async testEmbedding(): Promise<TestResult> {
    const t0 = Date.now()
    try {
      const e = this.settings.data.embedding
      if (!e.enabled) return { ok: false, message: '向量记忆没有开启' }
      const r = await this.embed(['测试'])
      return r?.[0]?.length ? { ok: true, message: `连接成功，向量维度 ${r[0].length}`, latencyMs: Date.now() - t0 } : { ok: false, message: '没有返回向量' }
    } catch (err) {
      return { ok: false, message: (err as Error).message }
    }
  }

  async embedPending(): Promise<void> {
    const e = this.settings.data.embedding
    if (!e.enabled) return
    try {
      for (let round = 0; round < 10; round++) {
        const batch = this.memory.needingEmbedding(e.model).slice(0, 32)
        if (!batch.length) return
        const vecs = await this.embed(batch.map((m) => m.text))
        if (!vecs) return
        this.memory.setEmbeddings(
          batch.map((m, i) => ({ id: m.id, embedding: vecs[i] })).filter((r) => Array.isArray(r.embedding)),
          e.model
        )
      }
    } catch (err) {
      console.warn('[memory] embedding failed:', (err as Error).message)
    }
  }

  // ---------------------------------------------------------------- weather

  async refreshWeather(force = false): Promise<{ ok: boolean; text?: string; error?: string }> {
    const w = this.settings.data.weather
    if (!w.enabled || !w.city.trim()) {
      this.weather = null
      return { ok: false, error: '没有开启天气或没有填写城市' }
    }
    if (!force && this.weather && this.weather.city === w.city && Date.now() - this.weather.fetchedAt < 80 * 60_000) {
      return { ok: true, text: describeWeather(this.weather) }
    }
    try {
      const res = await this.opts.fetch(weatherUrl(w.city), { headers: { 'User-Agent': 'curl/8' }, signal: AbortSignal.timeout(15_000) })
      if (!res.ok) throw new Error(`天气服务返回 ${res.status}`)
      const parsed = parseWttr(await res.json(), w.city.trim(), Date.now())
      if (!parsed) throw new Error('没有查到这个城市的天气')
      this.weather = parsed
      return { ok: true, text: describeWeather(parsed) }
    } catch (e) {
      console.warn('[weather]', (e as Error).message)
      return { ok: false, error: (e as Error).message }
    }
  }

  private situationLines(now: number): string[] {
    const lines = describeSpecialDays(new Date(now), this.game.data.createdAt)
    if (this.weather && now - this.weather.fetchedAt < 3 * 3_600_000) lines.push(`天气：${describeWeather(this.weather)}`)
    return lines
  }

  // ---------------------------------------------------------------- AI avatar

  async generateAvatar(desc: string): Promise<{ ok: boolean; dataUrl?: string; transparent?: boolean; error?: string }> {
    const g = this.settings.data.imageGen
    if (!desc.trim()) return { ok: false, error: '先描述一下想要的样子吧' }
    const key = g.keyFrom === 'own' ? this.secrets.get(IMAGE_SECRET) : this.secrets.get(g.keyFrom)
    try {
      const bytes = await generateImage(g, buildAvatarPrompt(desc), key, this.opts.fetch, AbortSignal.timeout(180_000))
      const b64 = Buffer.from(bytes).toString('base64')
      const mime = bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : bytes[0] === 0x52 ? 'image/webp' : 'image/png'
      return { ok: true, dataUrl: `data:${mime};base64,${b64}`, transparent: g.transparent }
    } catch (e) {
      console.warn('[avatar]', (e as Error).message)
      return { ok: false, error: (e as Error).message }
    }
  }

  // ---------------------------------------------------------------- speech-to-text

  async transcribe(audio: Uint8Array, mime: string): Promise<{ ok: boolean; text?: string; error?: string }> {
    const s = this.settings.data.stt
    if (!s.enabled) return { ok: false, error: '语音输入没有开启（设置 → 语音输入）' }
    const key = s.keyFrom === 'own' ? this.secrets.get(STT_SECRET) : this.secrets.get(s.keyFrom)
    try {
      const text = await transcribe({ baseURL: s.baseURL, model: s.model, language: s.language || undefined }, audio, mime, key, this.opts.fetch, AbortSignal.timeout(60_000))
      return text ? { ok: true, text } : { ok: false, error: '没听清，再说一遍吧~' }
    } catch (e) {
      console.warn('[stt]', (e as Error).message)
      return { ok: false, error: (e as Error).message }
    }
  }

  // ---------------------------------------------------------------- game

  gameAction(action: GameAction): Omit<ActionResult, 'state'> {
    const now = Date.now()
    this.lastPetInteractionAt = now
    const r = applyAction(tick(this.game.data, now, { difficulty: this.settings.data.game.difficulty }), action, now)
    this.setGame(r.state)
    if (r.ok && action.type !== 'chat') {
      const item = 'itemId' in action ? getItem(action.itemId) : undefined
      const label = action.type === 'buy' ? `买了${item?.name ?? ''}` : item ? `吃/用了${item.name}` : ACTION_LABEL[action.type]
      this.logActivity(`${label}：${r.message}`)
    }
    const { state: _s, ...rest } = r
    return rest
  }

  private logActivity(text: string): void {
    this.activity.update((a) => [...a.slice(-299), { ts: Date.now(), text }])
  }

  // ---------------------------------------------------------------- chat

  history(limit = 100): StoredMessage[] {
    return this.chatLog.recent(limit)
  }

  private say(text: string, opts: { emotion?: Emotion | null; proactive?: boolean; error?: boolean; save?: boolean } = {}): StoredMessage {
    const msg: StoredMessage = { id: uid('msg'), role: 'assistant', content: text, emotion: opts.emotion ?? null, ts: Date.now(), proactive: opts.proactive, error: opts.error }
    if (opts.save !== false) this.chatLog.append(msg)
    this.opts.broadcast('pet:say', { text, emotion: opts.emotion ?? null, anim: opts.emotion ? EMOTION_ANIM[opts.emotion] : undefined })
    return msg
  }

  /** Greeting on first launch (after the setup wizard). */
  greetIfNew(): void {
    const s = this.settings.data
    if (!s.setupDone) {
      this.say('你好呀~ 先在弹出的窗口里给我起个名字、接上“大脑”吧！', { emotion: 'happy', save: false })
      return
    }
    if (s.onboarded) return
    const { text, emotion } = stripEmotionTags(this.persona.data.greeting)
    this.say(text, { emotion })
    this.updateSettings({ onboarded: true })
  }

  completeSetup(): void {
    this.updateSettings({ setupDone: true })
    this.greetIfNew()
  }

  abortChat(): void {
    this.chatAbort?.abort()
  }

  async sendChat(userText: string): Promise<{ ok: boolean; error?: string }> {
    const text = userText.trim()
    if (!text) return { ok: false, error: '说点什么吧' }
    if (this.chatAbort) return { ok: false, error: '我还在想上一句呢，等等我~' }
    const now = Date.now()
    const id = uid('msg')
    const userMsg: StoredMessage = { id: uid('msg'), role: 'user', content: text, ts: now }
    const history = this.chatLog.recent(60)
    this.chatLog.append(userMsg)
    this.opts.broadcast('chat:start', { id, userText: text })
    this.gameAction({ type: 'chat' })

    // Explicit "记住……" is stored right away, before (and independent of) the LLM.
    const explicit = detectExplicitRemember(text)
    if (explicit) this.memory.add({ text: toThirdPerson(explicit), type: 'fact', importance: 8, source: 'explicit' }, now)

    const p = this.provider()
    if (!this.ready(p)) {
      const msg = this.say(
        explicit ? `我记住啦：${explicit}！不过我还没接上“大脑”，去设置里填一下 API Key 我就能陪你聊天了~` : '我还没有接上“大脑”呢……点一下托盘图标 → ⚙️ 设置，填一下 API Key 就能聊天啦~',
        { emotion: explicit ? 'happy' : 'sad' }
      )
      this.opts.broadcast('chat:done', { id, message: msg })
      return { ok: true }
    }
    if (this.overBudget()) {
      const msg = this.say('今天说了好多话，额度用完啦，明天再聊吧~（可以在设置里调整每日 token 上限）', { emotion: 'sleepy' })
      this.opts.broadcast('chat:done', { id, message: msg })
      return { ok: true }
    }

    const ctrl = new AbortController()
    this.chatAbort = ctrl
    this.onChatBusy(true)
    try {
      const s = this.settings.data
      let queryEmbedding: number[] | undefined
      try {
        queryEmbedding = (await this.embed([text], 4000))?.[0]
      } catch {
        /* lexical only */
      }
      const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant')?.content ?? ''
      const relevant = this.memory.search(`${text}\n${lastAssistant.slice(0, 80)}`, {
        now,
        k: s.memory.maxRetrieved,
        queryEmbedding,
        embeddingModel: s.embedding.model
      })
      this.memory.touch(relevant.map((r) => r.item.id), now)
      const g = this.game.data
      const system = buildSystemPrompt({
        persona: this.persona.data,
        game: g,
        coreMemories: this.memory.core(s.memory.maxCore),
        relevantMemories: relevant.map((r) => r.item),
        now: new Date(now),
        tasks: describeTasksForPrompt(this.tasks.data, now),
        situation: this.situationLines(now)
      })
      const messages = buildChatMessages(
        system,
        history.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content })),
        text,
        s.chat.historyChars
      )

      const parser = new EmotionStreamParser()
      const result = await chat(p, messages, {
        apiKey: this.keyFor(p),
        fetch: this.opts.fetch,
        signal: ctrl.signal,
        onDelta: (d) => {
          const out = parser.push(d)
          if (out.text || out.emotion) this.opts.broadcast('chat:delta', { id, delta: out.text, emotion: out.emotion })
        }
      })
      const tail = parser.flush()
      if (tail.text) this.opts.broadcast('chat:delta', { id, delta: tail.text, emotion: tail.emotion })
      this.recordUsage(result.usage.inputTokens, result.usage.outputTokens)
      const tagged = parseActionTags(result.text, Date.now())
      const notes = this.applyActionTags(tagged.actions)
      const clean = stripEmotionTags(tagged.text)
      const content = [clean.text || '……', ...notes].join('\n')
      const reply: StoredMessage = { id, role: 'assistant', content, emotion: clean.emotion ?? parser.emotion, ts: Date.now() }
      this.chatLog.append(reply)
      this.opts.broadcast('chat:done', { id, message: reply })

      if (s.memory.autoExtract && (worthExtracting(text) || !!explicit)) {
        const turns: ChatMessage[] = [
          ...history.slice(-2).map((m) => ({ role: m.role, content: m.content })),
          { role: 'user', content: text },
          { role: 'assistant', content: reply.content }
        ]
        this.enqueueMemoryJob(() => this.extractMemories(turns))
      }
      return { ok: true }
    } catch (e) {
      const err = e as Error
      const aborted = err.name === 'AbortError'
      const message = aborted ? '（被打断了）' : `呜……出错了：${err.message}`
      const msg: StoredMessage = { id, role: 'assistant', content: message, emotion: 'sad', ts: Date.now(), error: true }
      this.chatLog.append(msg)
      this.opts.broadcast('chat:error', { id, message })
      return { ok: false, error: err.message }
    } finally {
      this.chatAbort = null
      this.onChatBusy(false)
    }
  }

  clearChat(): void {
    this.chatLog.clear()
  }

  // ---------------------------------------------------------------- reminders / todos / focus

  private setTasks(next: TasksState): void {
    this.tasks.set(next)
    this.opts.broadcast('tasks:update', next)
  }

  /** Apply [[remind]] / [[todo]] tags from a reply; returns short notes appended to it. */
  private applyActionTags(actions: ReturnType<typeof parseActionTags>['actions']): string[] {
    const notes: string[] = []
    const now = Date.now()
    let st = this.tasks.data
    for (const a of actions) {
      if (a.kind === 'remind') {
        st = addReminder(st, { text: a.text, dueAt: a.dueAt, repeat: a.repeat, source: 'ai' }, now).state
        notes.push(`⏰ 已设提醒：${describeDue(a.dueAt, now)}${a.repeat === 'daily' ? '（每天）' : a.repeat === 'weekly' ? '（每周）' : ''} ${a.text}`)
      } else {
        st = addTodo(st, a.text, 'ai', now).state
        notes.push(`📝 已记待办：${a.text}`)
      }
    }
    if (actions.length) this.setTasks(st)
    return notes
  }

  addReminder(input: { text: string; dueAt: number; repeat?: Repeat }): TasksState {
    if (!input.text.trim()) throw new Error('提醒内容不能为空')
    this.setTasks(addReminder(this.tasks.data, { ...input, source: 'user' }, Date.now()).state)
    return this.tasks.data
  }

  addTodo(text: string): TasksState {
    if (!text.trim()) throw new Error('待办内容不能为空')
    this.setTasks(addTodo(this.tasks.data, text, 'user', Date.now()).state)
    return this.tasks.data
  }

  updateTasks(fn: (t: TasksState) => TasksState): TasksState {
    this.setTasks(fn(this.tasks.data))
    return this.tasks.data
  }

  focusActive(): boolean {
    const f = this.tasks.data.focus
    return !!f && f.endsAt > Date.now()
  }

  startFocus(minutes: number, label = ''): TasksState {
    const m = Math.max(1, Math.min(180, Math.round(minutes)))
    const now = Date.now()
    this.setTasks({ ...this.tasks.data, focus: { startedAt: now, endsAt: now + m * 60_000, minutes: m, label } })
    this.say(`好！我陪你专注 ${m} 分钟，加油~ 这段时间我不会打扰你。`, { emotion: 'excited', save: false })
    this.onFocusChange(true)
    return this.tasks.data
  }

  stopFocus(): TasksState {
    const f = this.tasks.data.focus
    if (!f) return this.tasks.data
    const doneMin = Math.floor((Date.now() - f.startedAt) / 60_000)
    this.setTasks({ ...this.tasks.data, focus: null })
    this.onFocusChange(false)
    if (doneMin >= 5) {
      const r = this.gameAction({ type: 'focus', minutes: doneMin })
      this.say(`提前结束啦，也坚持了 ${doneMin} 分钟。${r.message}`, { emotion: 'happy', save: false })
    } else {
      this.say('好吧，下次再一起专注~', { emotion: 'neutral', save: false })
    }
    return this.tasks.data
  }

  /** Set by the window layer (pauses walking while focusing). */
  onFocusChange: (active: boolean) => void = () => {}

  private taskTick(): void {
    const now = Date.now()
    const f = this.tasks.data.focus
    if (f && f.endsAt <= now) {
      this.setTasks({ ...this.tasks.data, focus: null })
      this.onFocusChange(false)
      const r = this.gameAction({ type: 'focus', minutes: f.minutes })
      const text = `🍅 ${f.minutes} 分钟专注完成！${r.message} 起来活动一下吧~`
      this.say(text, { emotion: 'excited', proactive: true })
      this.notify(`${this.persona.data.name}：专注完成`, text)
    }
    const { state, fired } = fireDue(this.tasks.data, now)
    if (!fired.length) return
    this.setTasks(state)
    for (const r of fired.slice(0, 3)) {
      const late = now - r.dueAt > 10 * 60_000 ? '（刚才错过了）' : ''
      const text = `⏰ ${this.persona.data.userCallName}，该${r.text.replace(/^(该|去)/, '')}啦！${late}`
      this.say(text, { emotion: 'excited', proactive: true })
      this.notify(`${this.persona.data.name} 提醒你`, r.text)
    }
  }

  // ---------------------------------------------------------------- memory

  publicMemory(m: MemoryItem): MemoryItemPublic {
    const { embedding, ...rest } = m
    return { ...rest, hasEmbedding: !!embedding }
  }

  private enqueueMemoryJob(job: () => Promise<void>): void {
    this.memoryQueue = this.memoryQueue.then(job).catch((e) => console.warn('[memory] job failed:', (e as Error).message))
  }

  async extractMemories(turns: ChatMessage[]): Promise<void> {
    const p = this.memoryProvider()
    if (!this.ready(p) || this.overBudget()) return
    const now = Date.now()
    const s = this.settings.data
    const query = turns.map((t) => t.content).join('\n')
    let queryEmbedding: number[] | undefined
    try {
      queryEmbedding = (await this.embed([query], 5000))?.[0]
    } catch {
      /* ignore */
    }
    const related = this.memory
      .search(query, { now, k: 8, includePinned: true, minRelevance: 0.05, queryEmbedding, embeddingModel: s.embedding.model })
      .map((r) => r.item)
    const persona = this.persona.data
    const messages = buildExtractionMessages({ petName: persona.name, userCallName: persona.userCallName, turns, related, now })
    const r = await chat(p, messages, {
      apiKey: this.keyFor(p),
      fetch: this.opts.fetch,
      maxTokens: p.kind === 'anthropic' ? 8000 : 800,
      json: true,
      signal: AbortSignal.timeout(60_000)
    })
    this.recordUsage(r.usage.inputTokens, r.usage.outputTokens)
    const ops = parseMemoryOps(r.text)
    if (ops.length) {
      const summary = applyMemoryOps(this.memory, ops, new Set(related.map((m) => m.id)), now)
      console.log(`[memory] +${summary.added.length} ~${summary.updated.length} -${summary.deleted.length}`)
      await this.embedPending()
    }
  }

  // ---------------------------------------------------------------- diary

  async generateDiary(date = dateKey(Date.now())): Promise<{ ok: boolean; entry?: DiaryEntry; error?: string }> {
    const p = this.memoryProvider()
    if (!this.ready(p)) return { ok: false, error: '需要先配置 AI 服务商' }
    const chatMsgs = this.chatLog
      .readDay(date)
      .filter((m) => !m.error)
      .map((m) => ({ role: m.role, content: m.content }) as ChatMessage)
    const activities = this.activity.data.filter((a) => dateKey(a.ts) === date).map((a) => a.text)
    try {
      const r = await chat(
        p,
        buildDiaryMessages({ persona: this.persona.data, date, chat: chatMsgs, activities, status: describeForPrompt(this.game.data) }),
        { apiKey: this.keyFor(p), fetch: this.opts.fetch, maxTokens: p.kind === 'anthropic' ? 8000 : 900, json: true, signal: AbortSignal.timeout(90_000) }
      )
      this.recordUsage(r.usage.inputTokens, r.usage.outputTokens)
      const parsed = parseDiary(r.text)
      if (!parsed) return { ok: false, error: '模型没有返回日记内容' }
      const entry: DiaryEntry = { date, text: parsed.diary, insights: parsed.insights, createdAt: Date.now() }
      this.diary.update((d) => [...d.filter((x) => x.date !== date), entry].sort((a, b) => b.date.localeCompare(a.date)))
      for (const ins of parsed.insights) this.memory.add({ text: ins, type: 'reflection', importance: 6, source: 'diary' }, Date.now())
      if (parsed.summary) this.memory.add({ text: parsed.summary, type: 'episode', importance: 4, source: 'diary' }, Date.now())
      void this.embedPending()
      return { ok: true, entry }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  /** Merge similar memories and forget stale trivia. Runs at most daily, or on demand. */
  /** Runs in the memory queue so it never interleaves with extraction (both rewrite memories). */
  consolidateMemories(force = false): Promise<{ ok: boolean; merged: number; forgotten: number; error?: string }> {
    return new Promise((resolve) =>
      this.enqueueMemoryJob(async () => {
        try {
          resolve(await this.consolidateNow(force))
        } catch (e) {
          resolve({ ok: false, merged: 0, forgotten: 0, error: (e as Error).message })
        }
      })
    )
  }

  private async consolidateNow(force: boolean): Promise<{ ok: boolean; merged: number; forgotten: number; error?: string }> {
    const now = Date.now()
    if (!force && now - this.runtime.data.lastDreamAt < 20 * 3_600_000) return { ok: true, merged: 0, forgotten: 0 }
    let forgotten = 0
    for (const m of forgettable(this.memory.all(), now)) if (this.memory.remove(m.id)) forgotten++
    const clusters = findClusters(this.memory.all())
    if (!clusters.length) {
      this.runtime.update((r) => ({ ...r, lastDreamAt: now }))
      return { ok: true, merged: 0, forgotten }
    }
    const p = this.memoryProvider()
    if (!this.ready(p)) return { ok: false, merged: 0, forgotten, error: '需要先配置 AI 服务商' }
    if (this.overBudget()) return { ok: false, merged: 0, forgotten, error: '今天的 token 额度用完了' }
    this.runtime.update((r) => ({ ...r, lastDreamAt: now }))
    try {
      const r = await chat(p, buildConsolidationMessages(this.persona.data.name, clusters), {
        apiKey: this.keyFor(p),
        fetch: this.opts.fetch,
        maxTokens: p.kind === 'anthropic' ? 8000 : 1200,
        json: true,
        signal: AbortSignal.timeout(90_000)
      })
      this.recordUsage(r.usage.inputTokens, r.usage.outputTokens)
      const merged = applyMerges(this.memory, parseMerges(r.text), clusters, Date.now())
      if (merged) void this.embedPending()
      console.log(`[memory] dream: merged ${merged} groups, forgot ${forgotten}`)
      return { ok: true, merged, forgotten }
    } catch (e) {
      return { ok: false, merged: 0, forgotten, error: (e as Error).message }
    }
  }

  private async diaryTick(): Promise<void> {
    if (this.memory.size >= 15) await this.consolidateMemories()
    if (!this.settings.data.memory.dailyDiary) return
    const yesterday = previousDateKey(Date.now())
    if (this.runtime.data.lastDiaryCheck === yesterday) return
    if (this.diary.data.some((d) => d.date === yesterday)) return
    const hadDay = this.chatLog.readDay(yesterday).some((m) => m.role === 'user')
    if (!hadDay || !this.ready(this.memoryProvider()) || this.overBudget()) return
    const tries = this.runtime.data.diaryTries.date === yesterday ? this.runtime.data.diaryTries.n : 0
    if (tries >= 3) return // give up for this day instead of retrying (and paying) every 30 minutes
    this.runtime.update((s) => ({ ...s, diaryTries: { date: yesterday, n: tries + 1 } }))
    const r = await this.generateDiary(yesterday)
    if (r.ok) {
      this.runtime.update((s) => ({ ...s, lastDiaryCheck: yesterday }))
      this.say('我把昨天的事写进日记里啦，在面板的“日记”里可以看哦~', { emotion: 'shy', proactive: true, save: false })
    }
  }

  // ---------------------------------------------------------------- proactive

  private async proactiveTick(): Promise<void> {
    const idle = this.opts.systemIdleSeconds()
    const returnedAfterSec = this.lastIdleSec >= 30 * 60 && idle < 60 ? this.lastIdleSec : 0
    this.lastIdleSec = idle
    const s = this.settings.data
    if (returnedAfterSec && this.game.data.asleep && this.game.data.stats.energy >= 60) {
      this.setGame({ ...this.game.data, asleep: false })
    }
    // Festivals / anniversaries: one greeting per day, same politeness rules as other proactive talk.
    const special = specialGreeting(new Date(), this.game.data.createdAt)
    const quiet = s.proactive.quietEnabled && inTimeWindow(new Date(), s.proactive.quietStart, s.proactive.quietEnd)
    if (special && special.key !== this.runtime.data.lastSpecial && !s.app.dnd && !this.fullscreenActive && !quiet && idle < 300 && s.proactive.level !== 'off' && !this.chatAbort) {
      this.runtime.update((r) => ({ ...r, lastSpecial: special.key }))
      this.say(special.text, { emotion: 'excited', proactive: true })
      return
    }
    const kind = decideProactive({
      now: new Date(),
      settings: s.proactive,
      dnd: s.app.dnd || this.focusActive() || this.fullscreenActive,
      game: this.game.data,
      state: this.runtime.data.proactive,
      systemIdleSec: idle,
      returnedAfterSec,
      lastPetInteractionAt: this.lastPetInteractionAt
    })
    if (!kind || this.chatAbort) return
    this.runtime.update((r) => ({ ...r, proactive: recordProactive(r.proactive, kind, Date.now()) }))
    let line = (s.proactive.useAI && (await this.aiProactiveLine(kind))) || proactiveLine(kind, this.persona.data.userCallName)
    if (kind === 'morning' && !s.proactive.useAI && this.weather && (this.weather.rainy || this.weather.snowy || this.weather.tempC <= 5 || this.weather.tempC >= 32)) {
      line += ` ${describeWeather(this.weather)}`
    }
    const { text, emotion } = stripEmotionTags(line)
    this.say(text, { emotion, proactive: true })
  }

  private async aiProactiveLine(kind: ProactiveKind): Promise<string | null> {
    const p = this.provider()
    if (!this.ready(p) || this.overBudget()) return null
    const reason: Record<ProactiveKind, string> = {
      morning: '早上刚见到对方，打个招呼', night: '夜深了，提醒对方早点休息', back: '对方离开电脑很久后刚回来',
      sick: '你生病了，向对方求助', hungry: '你饿了，撒娇要吃的', tired: '你困了', dirty: '你身上脏了想洗澡',
      miss: '对方很久没理你了', chatter: '随便找个轻松的话题搭话（可以结合你记得的事）'
    }
    try {
      const now = Date.now()
      const system = buildSystemPrompt({
        persona: this.persona.data,
        game: this.game.data,
        coreMemories: this.memory.core(this.settings.data.memory.maxCore),
        relevantMemories: this.memory.all().slice(0, 5),
        now: new Date(now),
        situation: this.situationLines(now),
        actions: false
      })
      const r = await chat(
        p,
        [
          { role: 'system', content: system },
          { role: 'user', content: `（系统提示，不是对方说的话）现在请你主动对${this.persona.data.userCallName}说一句话。原因：${reason[kind]}。不超过 30 个字。` }
        ],
        { apiKey: this.keyFor(p), fetch: this.opts.fetch, maxTokens: p.kind === 'anthropic' ? 2000 : 120, signal: AbortSignal.timeout(20_000) }
      )
      this.recordUsage(r.usage.inputTokens, r.usage.outputTokens)
      return r.text.trim() || null
    } catch {
      return null
    }
  }
}
