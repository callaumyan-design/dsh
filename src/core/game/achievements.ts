/** Achievement badges and small random events — pure functions over GameState. */
import { DAY } from '../util'
import { getItem } from './items'
import type { GameState } from './types'

export interface AchievementDef {
  id: string
  name: string
  desc: string
  emoji: string
  reward: number
  check: (g: GameState, ctx: AchievementContext) => boolean
}

export interface AchievementContext {
  now: number
  memoryCount: number
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_meal', name: '第一口饭', desc: '第一次喂它吃东西', emoji: '🍙', reward: 10, check: (g) => g.totals.fed >= 1 },
  { id: 'gourmet', name: '小小美食家', desc: '累计喂食 50 次', emoji: '🍱', reward: 60, check: (g) => g.totals.fed >= 50 },
  { id: 'chatty', name: '话匣子', desc: '聊天 20 次', emoji: '💬', reward: 30, check: (g) => g.totals.chats >= 20 },
  { id: 'best_listener', name: '最佳听众', desc: '聊天 200 次', emoji: '🎧', reward: 120, check: (g) => g.totals.chats >= 200 },
  { id: 'petter', name: '摸摸怪', desc: '摸摸它 100 次', emoji: '🤲', reward: 40, check: (g) => g.totals.pets >= 100 },
  { id: 'clean', name: '爱干净', desc: '洗澡 20 次', emoji: '🛁', reward: 40, check: (g) => g.totals.baths >= 20 },
  { id: 'worker', name: '打工人', desc: '打工 10 次', emoji: '💼', reward: 50, check: (g) => g.totals.worked >= 10 },
  { id: 'scholar', name: '好学生', desc: '学习 10 次', emoji: '📚', reward: 50, check: (g) => g.totals.studied >= 10 },
  { id: 'focus_1h', name: '专注一小时', desc: '累计专注 60 分钟', emoji: '🍅', reward: 40, check: (g) => (g.totals.focusMinutes ?? 0) >= 60 },
  { id: 'focus_10h', name: '专注达人', desc: '累计专注 600 分钟', emoji: '🏅', reward: 200, check: (g) => (g.totals.focusMinutes ?? 0) >= 600 },
  { id: 'streak_7', name: '七日之约', desc: '连续签到 7 天', emoji: '📅', reward: 80, check: (g) => g.checkInStreak >= 7 },
  { id: 'child', name: '长大啦', desc: '成长到少年阶段（Lv.5）', emoji: '🌱', reward: 50, check: (g) => g.level >= 5 },
  { id: 'adult', name: '成年礼', desc: '成长到成年阶段（Lv.15）', emoji: '🌳', reward: 150, check: (g) => g.level >= 15 },
  { id: 'friends', name: '好朋友', desc: '好感达到 500', emoji: '🤝', reward: 100, check: (g) => g.affection >= 500 },
  { id: 'soulmate', name: '灵魂伴侣', desc: '好感达到 1000', emoji: '💞', reward: 300, check: (g) => g.affection >= 1000 },
  { id: 'rich', name: '小富翁', desc: '同时拥有 500 金币', emoji: '💰', reward: 0, check: (g) => g.coins >= 500 },
  { id: 'memory_20', name: '好记性', desc: '记住关于你的 20 件事', emoji: '🧠', reward: 60, check: (_g, c) => c.memoryCount >= 20 },
  { id: 'month', name: '一个月的陪伴', desc: '相处满 30 天', emoji: '🎂', reward: 150, check: (g, c) => c.now - g.createdAt >= 30 * DAY }
]

export function checkAchievements(g: GameState, ctx: AchievementContext): { state: GameState; unlocked: AchievementDef[] } {
  const have = g.achievements ?? {}
  const unlocked = ACHIEVEMENTS.filter((a) => !have[a.id] && a.check(g, ctx))
  if (!unlocked.length) return { state: g, unlocked }
  const achievements = { ...have }
  let coins = g.coins
  for (const a of unlocked) {
    achievements[a.id] = ctx.now
    coins += a.reward
  }
  return { state: { ...g, achievements, coins }, unlocked }
}

// ---------------------------------------------------------------- random events

export interface RandomEvent {
  id: string
  text: string
  state: GameState
}

type EventGen = (g: GameState, rand: () => number) => { text: string; state: GameState } | null

const EVENTS: Array<{ id: string; weight: number; asleep: boolean; gen: EventGen }> = [
  {
    id: 'coin',
    weight: 3,
    asleep: false,
    gen: (g, r) => {
      const n = 5 + Math.floor(r() * 11)
      return { text: `在桌面角落里捡到了 ${n} 枚金币！`, state: { ...g, coins: g.coins + n } }
    }
  },
  {
    id: 'apple',
    weight: 2,
    asleep: false,
    gen: (g) => {
      const item = getItem('apple')!
      return { text: `窗外掉进来一个${item.name}，先收进背包啦~`, state: { ...g, inventory: { ...g.inventory, apple: (g.inventory.apple ?? 0) + 1 } } }
    }
  },
  {
    id: 'butterfly',
    weight: 2,
    asleep: false,
    gen: (g) => ({ text: '刚才有只蝴蝶飞过屏幕，追了它好一会儿，好开心！', state: { ...g, stats: { ...g.stats, mood: Math.min(100, g.stats.mood + 6) } } })
  },
  {
    id: 'craving',
    weight: 1,
    asleep: false,
    gen: (g) => (g.stats.satiety < 70 ? { text: '突然好想吃草莓蛋糕……（咽口水）', state: g } : null)
  },
  {
    id: 'dream',
    weight: 3,
    asleep: true,
    gen: (g, r) => {
      const dreams = ['梦见自己变成了一朵云', '梦见和你一起去海边', '梦见吃了一大桌饭团', '梦见在键盘上跳舞']
      return { text: `（说梦话）……${dreams[Math.floor(r() * dreams.length)]}……嘿嘿`, state: { ...g, stats: { ...g.stats, mood: Math.min(100, g.stats.mood + 3) } } }
    }
  }
]

/** Roll for a small random event. `chance` is the per-call probability. */
export function rollRandomEvent(g: GameState, rand: () => number = Math.random, chance = 1 / 60): RandomEvent | null {
  if (rand() >= chance) return null
  const pool = EVENTS.filter((e) => e.asleep === g.asleep)
  const total = pool.reduce((s, e) => s + e.weight, 0)
  let pick = rand() * total
  for (const e of pool) {
    pick -= e.weight
    if (pick <= 0) {
      const r = e.gen(g, rand)
      return r ? { id: e.id, ...r } : null
    }
  }
  return null
}
