/**
 * Decides when the pet speaks up on its own. Pure function of the context so it is easy to
 * test. Budgeted by level (max per day + min gap), muted by DND and quiet hours, and never
 * talks to an empty room (system idle).
 */
import { conditions } from './game/engine'
import type { GameState } from './game/types'
import { dateKey, inTimeWindow } from './util'

export type ProactiveLevel = 'off' | 'low' | 'medium' | 'high'

export interface ProactiveSettings {
  level: ProactiveLevel
  quietEnabled: boolean
  quietStart: string
  quietEnd: string
  /** Generate lines with the LLM instead of the built-in phrase bank. */
  useAI: boolean
}

export const LEVEL_BUDGET: Record<Exclude<ProactiveLevel, 'off'>, { perDay: number; minGapMin: number; chatterChance: number }> = {
  low: { perDay: 3, minGapMin: 120, chatterChance: 0.05 },
  medium: { perDay: 6, minGapMin: 60, chatterChance: 0.1 },
  high: { perDay: 10, minGapMin: 30, chatterChance: 0.2 }
}

export type ProactiveKind = 'morning' | 'night' | 'back' | 'sick' | 'hungry' | 'tired' | 'dirty' | 'miss' | 'chatter'

export interface ProactiveState {
  date: string
  count: number
  lastAt: number
  greetedMorning: string | null
  greetedNight: string | null
}

export function freshProactiveState(now: number): ProactiveState {
  return { date: dateKey(now), count: 0, lastAt: 0, greetedMorning: null, greetedNight: null }
}

export interface ProactiveContext {
  now: Date
  settings: ProactiveSettings
  dnd: boolean
  game: GameState
  state: ProactiveState
  /** Seconds since last keyboard/mouse input anywhere on the system. */
  systemIdleSec: number
  /** How long the user had been away before coming back (seconds), 0 if not just returned. */
  returnedAfterSec: number
  /** ms timestamp of the user's last interaction with the pet itself. */
  lastPetInteractionAt: number
  random?: () => number
}

const LINES: Record<ProactiveKind, string[]> = {
  morning: ['[happy]早上好呀{user}！今天也要元气满满哦~', '[sleepy]唔……早安{user}，你起得好早'],
  night: ['[sleepy]{user}，已经很晚啦，早点休息好不好？', '[love]夜深了，{user}要记得早点睡哦~'],
  back: ['[excited]{user}回来啦！刚刚我一个人好无聊~', '[happy]欢迎回来，{user}！'],
  sick: ['[sad]{user}……我好像生病了，身体软绵绵的', '[sad]呜，有点难受，能给我找点药吗？'],
  hungry: ['[sad]{user}，我肚子在咕咕叫了……', '[shy]那个……可以给我点吃的吗？'],
  tired: ['[sleepy]好困哦……我想睡一会儿', '[sleepy]眼睛快睁不开了……'],
  dirty: ['[shy]我身上脏脏的，想洗个泡泡浴~', '[sad]感觉黏糊糊的，想洗澡……'],
  miss: ['[sad]{user}好久没理我了……陪我玩一会儿嘛', '[shy]戳戳……{user}还记得我吗？'],
  chatter: ['[thinking]{user}，你今天过得怎么样呀？', '[happy]我刚刚数了数你桌面上的图标，好多呀~', '[thinking]在忙什么呢？要不要休息一下眼睛？']
}

export function proactiveLine(kind: ProactiveKind, userCallName: string, random: () => number = Math.random): string {
  const pool = LINES[kind]
  return pool[Math.floor(random() * pool.length) % pool.length].replaceAll('{user}', userCallName)
}

export function rollProactiveState(state: ProactiveState, now: number): ProactiveState {
  const today = dateKey(now)
  return state.date === today ? state : { ...state, date: today, count: 0 }
}

export function decideProactive(ctx: ProactiveContext): ProactiveKind | null {
  const { settings, now } = ctx
  if (settings.level === 'off' || ctx.dnd) return null
  if (settings.quietEnabled && inTimeWindow(now, settings.quietStart, settings.quietEnd)) return null
  if (ctx.systemIdleSec > 300) return null // nobody is looking
  const budget = LEVEL_BUDGET[settings.level]
  const st = rollProactiveState(ctx.state, now.getTime())
  if (st.count >= budget.perDay) return null
  const sinceLast = (now.getTime() - st.lastAt) / 60_000
  const random = ctx.random ?? Math.random
  const today = dateKey(now)
  const hour = now.getHours()

  // Greetings ignore the min gap but still count toward the daily budget.
  if (ctx.returnedAfterSec >= 30 * 60) return 'back'
  if (hour >= 6 && hour < 10 && st.greetedMorning !== today) return 'morning'
  if (hour >= 22 && st.greetedNight !== today) return 'night'

  if (sinceLast < budget.minGapMin) return null
  if (!ctx.game.asleep) {
    const c = conditions(ctx.game)
    if (c.includes('sick')) return 'sick'
    if (c.includes('starving') || c.includes('hungry')) return 'hungry'
    if (c.includes('exhausted') || c.includes('tired')) return 'tired'
    if (c.includes('dirty')) return 'dirty'
  }
  if (now.getTime() - ctx.lastPetInteractionAt > 3 * 3_600_000) return 'miss'
  if (random() < budget.chatterChance) return 'chatter'
  return null
}

export function recordProactive(state: ProactiveState, kind: ProactiveKind, now: number): ProactiveState {
  const st = rollProactiveState(state, now)
  const today = dateKey(now)
  return {
    ...st,
    count: st.count + 1,
    lastAt: now,
    greetedMorning: kind === 'morning' ? today : st.greetedMorning,
    greetedNight: kind === 'night' ? today : st.greetedNight
  }
}
