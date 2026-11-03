/**
 * Pure tamagotchi engine. Every function takes a state and returns a new one,
 * so it is trivially testable and the main process only has to persist JSON.
 *
 * Numbers are inspired by VPet / DyberPet style care loops, re-designed so the
 * pet never permanently dies: neglect makes it sick and grumpy, not gone.
 */
import { clamp, dateKey, HOUR, previousDateKey, round1 } from '../util'
import { getItem, STARTER_INVENTORY } from './items'
import type {
  ActionResult,
  Condition,
  Delta,
  Difficulty,
  GameAction,
  GameState,
  Stage,
  StatKey,
  Stats
} from './types'

export const DIFFICULTY_MULTIPLIER: Record<Difficulty, number> = { casual: 0.5, normal: 1, hard: 1.6 }

/** Per-hour drift at difficulty "normal". */
export const RATES = {
  satiety: -5,
  cleanliness: -2.5,
  energyAwake: -3,
  energyAsleep: 16,
  moodBase: -1
}

/** Offline decay is gentler and never pushes a stat below these floors. */
export const OFFLINE_FLOORS: Stats = { satiety: 20, mood: 25, energy: 20, cleanliness: 20, health: 40 }
export const OFFLINE_RATE = 0.6

export const COOLDOWN_MS = { work: 20 * 60_000, study: 20 * 60_000, play: 60_000, pet: 3_000 }

export const MAX_AFFECTION = 1000

export function createGame(now: number): GameState {
  return {
    version: 1,
    createdAt: now,
    lastTick: now,
    stats: { satiety: 80, mood: 75, energy: 90, cleanliness: 90, health: 100 },
    affection: 0,
    exp: 0,
    level: 1,
    coins: 50,
    inventory: { ...STARTER_INVENTORY },
    asleep: false,
    lastCheckIn: null,
    checkInStreak: 0,
    cooldowns: {},
    daily: { date: dateKey(now), affectionFromChat: 0, affectionFromPet: 0 },
    totals: { fed: 0, played: 0, worked: 0, studied: 0, chats: 0, baths: 0, pets: 0, focusMinutes: 0 },
    lastPetAt: 0
  }
}

/** Fill in fields added in later versions so old saves keep loading. */
export function normalizeGame(raw: Partial<GameState> | null | undefined, now: number): GameState {
  const base = createGame(now)
  if (!raw || typeof raw !== 'object') return base
  return {
    ...base,
    ...raw,
    stats: { ...base.stats, ...(raw.stats ?? {}) },
    inventory: { ...(raw.inventory ?? base.inventory) },
    cooldowns: { ...(raw.cooldowns ?? {}) },
    daily: { ...base.daily, ...(raw.daily ?? {}) },
    totals: { ...base.totals, ...(raw.totals ?? {}) },
    version: 1
  }
}

export function expToNext(level: number): number {
  return 50 + (level - 1) * 25
}

export function stageOf(level: number): Stage {
  if (level < 5) return 'baby'
  if (level < 15) return 'child'
  return 'adult'
}

export const STAGE_LABEL: Record<Stage, string> = { baby: '幼年', child: '少年', adult: '成年' }
export const STAGE_SCALE: Record<Stage, number> = { baby: 0.78, child: 0.9, adult: 1 }

const AFFECTION_TIERS: Array<[number, string]> = [
  [1000, '灵魂伴侣'],
  [800, '挚友'],
  [500, '好朋友'],
  [250, '朋友'],
  [100, '熟悉'],
  [0, '初识']
]

export function affectionTitle(affection: number): string {
  for (const [min, title] of AFFECTION_TIERS) if (affection >= min) return title
  return '初识'
}

export function conditions(state: GameState): Condition[] {
  const s = state.stats
  const out: Condition[] = []
  if (s.health < 30) out.push('sick')
  if (s.satiety < 15) out.push('starving')
  else if (s.satiety < 35) out.push('hungry')
  if (s.energy < 10) out.push('exhausted')
  else if (s.energy < 25) out.push('tired')
  if (s.cleanliness < 30) out.push('dirty')
  if (s.mood < 30) out.push('sad')
  if (out.length === 0) out.push(s.mood >= 75 ? 'happy' : 'content')
  return out
}

export const CONDITION_LABEL: Record<Condition, string> = {
  sick: '生病了',
  starving: '饿坏了',
  hungry: '有点饿',
  exhausted: '累坏了',
  tired: '有点困',
  dirty: '脏兮兮的',
  sad: '不太开心',
  happy: '心情很好',
  content: '状态不错'
}

function rollDaily(state: GameState, now: number): GameState {
  const today = dateKey(now)
  if (state.daily.date === today) return state
  return { ...state, daily: { date: today, affectionFromChat: 0, affectionFromPet: 0 } }
}

export interface TickOptions {
  difficulty?: Difficulty
  /** True when catching up on time the app was closed. */
  offline?: boolean
  maxOfflineHours?: number
}

/** Advance the simulation to `now`. */
export function tick(state: GameState, now: number, opts: TickOptions = {}): GameState {
  const elapsed = now - state.lastTick
  if (elapsed <= 0) return rollDaily(state, now)
  let hours = elapsed / HOUR
  let mul = DIFFICULTY_MULTIPLIER[opts.difficulty ?? 'normal']
  if (opts.offline) {
    hours = Math.min(hours, opts.maxOfflineHours ?? 12)
    mul *= OFFLINE_RATE
  }

  const s: Stats = { ...state.stats }
  let asleep = state.asleep
  // Integrate in small steps so threshold-based effects (e.g. hunger hurting health) are stable.
  const steps = Math.max(1, Math.ceil(hours / 0.25))
  const dt = hours / steps
  for (let i = 0; i < steps; i++) {
    const sleepFactor = asleep ? 0.5 : 1
    s.satiety += RATES.satiety * mul * sleepFactor * dt
    s.cleanliness += RATES.cleanliness * mul * sleepFactor * dt
    s.energy += (asleep ? RATES.energyAsleep : RATES.energyAwake * mul) * dt

    let moodDelta = RATES.moodBase * mul
    if (s.satiety < 25) moodDelta -= 3 * mul
    if (s.cleanliness < 25) moodDelta -= 2 * mul
    if (s.health < 30) moodDelta -= 3 * mul
    if (s.energy < 15) moodDelta -= 2 * mul
    if (s.satiety > 60 && s.cleanliness > 60 && s.energy > 40 && s.health > 60) moodDelta += 1.5
    s.mood += moodDelta * (asleep ? 0.3 : 1) * dt

    let healthDelta = 0
    if (s.satiety < 20) healthDelta -= 3 * mul
    if (s.cleanliness < 20) healthDelta -= 2 * mul
    if (s.satiety > 50 && s.cleanliness > 50) healthDelta += 1.2
    s.health += healthDelta * dt

    for (const k of Object.keys(s) as StatKey[]) s[k] = clamp(s[k])
    if (opts.offline) for (const k of Object.keys(s) as StatKey[]) s[k] = Math.max(s[k], Math.min(OFFLINE_FLOORS[k], state.stats[k]))
    if (asleep && s.energy >= 100) asleep = false
  }

  for (const k of Object.keys(s) as StatKey[]) s[k] = round1(s[k])
  return rollDaily({ ...state, stats: s, asleep, lastTick: now }, now)
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

interface Draft {
  state: GameState
  delta: Delta
  leveledUp?: number
}

function applyStats(d: Draft, changes: Partial<Record<StatKey, number>>): void {
  const stats = { ...d.state.stats }
  for (const [k, v] of Object.entries(changes) as Array<[StatKey, number]>) {
    const before = stats[k]
    stats[k] = round1(clamp(before + v))
    d.delta[k] = round1((d.delta[k] ?? 0) + (stats[k] - before))
  }
  d.state = { ...d.state, stats }
}

function addAffection(d: Draft, n: number): void {
  const before = d.state.affection
  const after = clamp(before + n, 0, MAX_AFFECTION)
  d.state = { ...d.state, affection: after }
  d.delta.affection = (d.delta.affection ?? 0) + (after - before)
}

function addCoins(d: Draft, n: number): void {
  d.state = { ...d.state, coins: Math.max(0, d.state.coins + n) }
  d.delta.coins = (d.delta.coins ?? 0) + n
}

function addExp(d: Draft, n: number): void {
  let { exp, level, coins } = d.state
  exp += n
  d.delta.exp = (d.delta.exp ?? 0) + n
  while (exp >= expToNext(level)) {
    exp -= expToNext(level)
    level += 1
    coins += level * 10
    d.leveledUp = level
  }
  d.state = { ...d.state, exp, level, coins }
}

function onCooldown(state: GameState, key: string, now: number): number {
  const until = state.cooldowns[key] ?? 0
  return until > now ? until - now : 0
}

function setCooldown(d: Draft, key: string, now: number, ms: number): void {
  d.state = { ...d.state, cooldowns: { ...d.state.cooldowns, [key]: now + ms } }
}

function bumpTotal(d: Draft, key: keyof GameState['totals'], n = 1): void {
  d.state = { ...d.state, totals: { ...d.state.totals, [key]: (d.state.totals[key] ?? 0) + n } }
}

function consume(d: Draft, itemId: string, n = 1): void {
  const inv = { ...d.state.inventory }
  inv[itemId] = (inv[itemId] ?? 0) - n
  if (inv[itemId] <= 0) delete inv[itemId]
  d.state = { ...d.state, inventory: inv }
}

function fail(state: GameState, message: string): ActionResult {
  return { ok: false, state, message, delta: {} }
}

function minutes(ms: number): string {
  return `${Math.max(1, Math.ceil(ms / 60_000))} 分钟`
}

function done(d: Draft, message: string, anim?: ActionResult['anim']): ActionResult {
  const lv = d.leveledUp ? ` 升级到 Lv.${d.leveledUp} 啦！` : ''
  return { ok: true, state: d.state, message: message + lv, anim, delta: d.delta, leveledUp: d.leveledUp }
}

export function applyAction(input: GameState, action: GameAction, now: number): ActionResult {
  const state = rollDaily(input, now)
  const d: Draft = { state, delta: {} }

  switch (action.type) {
    case 'pet': {
      bumpTotal(d, 'pets')
      if (state.asleep) {
        applyStats(d, { mood: 1 })
        return done(d, 'Zzz……（睡梦中蹭了蹭你）', 'sleep')
      }
      if (now - state.lastPetAt < COOLDOWN_MS.pet) {
        applyStats(d, { mood: 1 })
        d.state = { ...d.state, lastPetAt: now }
        return done(d, '别戳啦，要被戳扁了~', 'shy')
      }
      applyStats(d, { mood: 5 })
      if (state.daily.affectionFromPet < 40) {
        addAffection(d, 2)
        d.state = { ...d.state, daily: { ...d.state.daily, affectionFromPet: d.state.daily.affectionFromPet + 2 } }
      }
      addExp(d, 1)
      d.state = { ...d.state, lastPetAt: now }
      return done(d, '好舒服~', 'happy')
    }

    case 'play': {
      if (state.asleep) return fail(state, '它正在睡觉，等它醒了再玩吧')
      if (state.stats.health < 30) return fail(state, '它生病了，先治病吧')
      if (state.stats.energy < 15) return fail(state, '太累了，玩不动了……')
      const cd = onCooldown(state, 'play', now)
      if (cd) return fail(state, '刚玩过，歇一会儿吧')
      const toyBonus = (state.inventory.ball ?? 0) > 0 ? (getItem('ball')?.effects.mood ?? 0) : 0
      applyStats(d, { mood: 15 + toyBonus, energy: -10, satiety: -5, cleanliness: -6 })
      addAffection(d, 3)
      addExp(d, 6)
      bumpTotal(d, 'played')
      setCooldown(d, 'play', now, COOLDOWN_MS.play)
      return done(d, toyBonus ? '玩弹力球玩得好开心！' : '玩得好开心！', 'play')
    }

    case 'bath': {
      if (state.asleep) return fail(state, '它正在睡觉')
      if ((state.inventory.soap ?? 0) > 0) {
        consume(d, 'soap')
        applyStats(d, { cleanliness: 100, mood: 5 })
        addExp(d, 2)
        bumpTotal(d, 'baths')
        return done(d, '泡泡浴好舒服，香喷喷的~', 'bath')
      }
      applyStats(d, { cleanliness: 30, mood: -2 })
      addExp(d, 1)
      bumpTotal(d, 'baths')
      return done(d, '没有泡泡浴了，只能用清水冲一冲', 'bath')
    }

    case 'sleep': {
      if (state.asleep) return fail(state, '已经在睡啦')
      if (state.stats.energy > 85) return fail(state, '还不困呢，再玩一会儿嘛')
      d.state = { ...d.state, asleep: true }
      return done(d, '晚安……Zzz', 'sleep')
    }

    case 'wake': {
      if (!state.asleep) return fail(state, '它醒着呢')
      d.state = { ...d.state, asleep: false }
      if (state.stats.energy < 30) {
        applyStats(d, { mood: -5 })
        return done(d, '被吵醒了……好困', 'sad')
      }
      return done(d, '睡饱啦！', 'wave')
    }

    case 'work':
    case 'study': {
      const isWork = action.type === 'work'
      if (state.asleep) return fail(state, '它正在睡觉')
      if (state.stats.health < 30) return fail(state, '生病了，先休息吧')
      if (state.stats.energy < (isWork ? 25 : 20)) return fail(state, '没精神了，先睡一觉吧')
      if (isWork && state.stats.satiety < 20) return fail(state, '饿着肚子没法干活')
      const cd = onCooldown(state, action.type, now)
      if (cd) return fail(state, `${isWork ? '打工' : '学习'}需要休息，${minutes(cd)}后再来`)
      if (isWork) {
        const pay = 12 + state.level * 3
        applyStats(d, { energy: -18, satiety: -10, mood: -5, cleanliness: -4 })
        addCoins(d, pay)
        addExp(d, 8)
        bumpTotal(d, 'worked')
        setCooldown(d, 'work', now, COOLDOWN_MS.work)
        return done(d, `打工回来了，赚了 ${pay} 金币！`, 'work')
      }
      applyStats(d, { energy: -12, satiety: -5, mood: -4 })
      addExp(d, 18)
      bumpTotal(d, 'studied')
      setCooldown(d, 'study', now, COOLDOWN_MS.study)
      return done(d, '认真学习了一会儿，变聪明了！', 'work')
    }

    case 'feed':
    case 'use': {
      const item = getItem(action.itemId)
      if (!item) return fail(state, '没有这个物品')
      if ((state.inventory[item.id] ?? 0) <= 0) return fail(state, `背包里没有${item.name}了`)
      if (state.asleep) return fail(state, '它正在睡觉')
      if (item.kind === 'toy') return applyAction(state, { type: 'play' }, now)
      if (item.kind === 'care') return applyAction(state, { type: 'bath' }, now)
      if ((item.kind === 'food' || item.kind === 'drink') && (item.effects.satiety ?? 0) > 0 && state.stats.satiety >= 95) {
        return fail(state, '吃不下了，肚子要撑破啦')
      }
      if (item.kind === 'medicine' && state.stats.health >= 80) return fail(state, '很健康，不需要吃药')
      const { affection, ...stats } = item.effects
      applyStats(d, stats)
      if (affection) addAffection(d, affection)
      if (item.consumable) consume(d, item.id)
      addExp(d, 2)
      if (item.kind === 'food' || item.kind === 'drink') bumpTotal(d, 'fed')
      const msg =
        item.kind === 'gift' ? `收到了${item.name}，好感动！` : item.kind === 'medicine' ? '好苦……不过感觉好多了' : `${item.name}真好吃！`
      return done(d, msg, item.kind === 'food' || item.kind === 'drink' ? 'eat' : 'happy')
    }

    case 'buy': {
      const item = getItem(action.itemId)
      if (!item) return fail(state, '没有这个商品')
      const count = Math.max(1, Math.floor(action.count ?? 1))
      if (!item.consumable && (state.inventory[item.id] ?? 0) > 0) return fail(state, `已经有${item.name}了`)
      const cost = item.price * count
      if (state.coins < cost) return fail(state, `金币不够（需要 ${cost}）`)
      addCoins(d, -cost)
      d.state = { ...d.state, inventory: { ...d.state.inventory, [item.id]: (d.state.inventory[item.id] ?? 0) + count } }
      return done(d, `买到了 ${item.emoji}${item.name} ×${count}`)
    }

    case 'checkIn': {
      const today = dateKey(now)
      if (state.lastCheckIn === today) return fail(state, '今天已经签到过啦')
      const streak = state.lastCheckIn === previousDateKey(now) ? state.checkInStreak + 1 : 1
      const reward = 20 + Math.min(streak, 7) * 5
      addCoins(d, reward)
      addExp(d, 10)
      d.state = { ...d.state, lastCheckIn: today, checkInStreak: streak }
      return done(d, `签到成功！连续 ${streak} 天，获得 ${reward} 金币`, 'wave')
    }

    case 'focus': {
      const m = Math.round(clamp(action.minutes, 1, 180))
      const coins = Math.round(m * 0.8)
      applyStats(d, { energy: -Math.min(20, m / 2.5), satiety: -Math.min(10, m / 5), mood: 4 })
      addCoins(d, coins)
      addExp(d, Math.round(m * 0.6))
      addAffection(d, Math.min(10, Math.round(m / 5)))
      bumpTotal(d, 'focusMinutes', m)
      return done(d, `一起专注了 ${m} 分钟，辛苦啦！获得 ${coins} 金币`, 'happy')
    }

    case 'chat': {
      applyStats(d, { mood: 2 })
      if (state.daily.affectionFromChat < 20) {
        addAffection(d, 1)
        d.state = { ...d.state, daily: { ...d.state.daily, affectionFromChat: d.state.daily.affectionFromChat + 1 } }
      }
      addExp(d, 2)
      bumpTotal(d, 'chats')
      return done(d, '')
    }
  }
}

/** Short natural-language summary injected into the LLM system prompt. */
export function describeForPrompt(state: GameState): string {
  const s = state.stats
  const word = (v: number, hi: string, mid: string, lo: string, bad: string) => (v >= 70 ? hi : v >= 40 ? mid : v >= 20 ? lo : bad)
  const parts = [
    `饱食：${word(s.satiety, '吃饱了', '还行', '有点饿', '饿坏了')}`,
    `心情：${word(s.mood, '很开心', '一般', '有点低落', '很难过')}`,
    `精力：${word(s.energy, '精力充沛', '还行', '有点困', '困得睁不开眼')}`,
    `清洁：${word(s.cleanliness, '干干净净', '还行', '有点脏', '脏兮兮')}`,
    `健康：${word(s.health, '健康', '还好', '不太舒服', '生病了')}`
  ]
  const stage = STAGE_LABEL[stageOf(state.level)]
  return [
    `成长阶段：${stage}（Lv.${state.level}）`,
    `和用户的关系：${affectionTitle(state.affection)}（好感 ${Math.round(state.affection)}/${MAX_AFFECTION}）`,
    `身体状况：${parts.join('，')}`,
    state.asleep ? '你现在正在睡觉（被叫醒了，迷迷糊糊的）' : ''
  ]
    .filter(Boolean)
    .join('\n')
}
