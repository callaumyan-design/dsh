import { describe, expect, it } from 'vitest'
import { checkAchievements, rollRandomEvent } from '../src/core/game/achievements'
import { createGame } from '../src/core/game/engine'

const NOW = new Date(2026, 10, 3, 12).getTime()

describe('achievements', () => {
  it('unlocks once and pays the reward', () => {
    const g = { ...createGame(NOW), totals: { ...createGame(NOW).totals, fed: 1 } }
    const r = checkAchievements(g, { now: NOW, memoryCount: 0 })
    expect(r.unlocked.map((a) => a.id)).toEqual(['first_meal'])
    expect(r.state.coins).toBe(g.coins + 10)
    expect(r.state.achievements.first_meal).toBe(NOW)
    expect(checkAchievements(r.state, { now: NOW, memoryCount: 0 }).unlocked).toEqual([])
  })

  it('context-based achievements', () => {
    const g = createGame(NOW - 31 * 86_400_000)
    const ids = checkAchievements(g, { now: NOW, memoryCount: 25 }).unlocked.map((a) => a.id)
    expect(ids).toContain('memory_20')
    expect(ids).toContain('month')
  })
})

describe('random events', () => {
  it('respects the chance and picks asleep/awake events', () => {
    const g = createGame(NOW)
    expect(rollRandomEvent(g, () => 0.99)).toBeNull()
    const seq = [0, 0, 0.5]
    let i = 0
    const ev = rollRandomEvent(g, () => seq[i++ % seq.length])!
    expect(ev.id).toBe('coin')
    expect(ev.state.coins).toBeGreaterThan(g.coins)
    const asleep = rollRandomEvent({ ...g, asleep: true }, () => 0)!
    expect(asleep.id).toBe('dream')
  })
})
