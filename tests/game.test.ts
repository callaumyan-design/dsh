import { describe, expect, it } from 'vitest'
import { applyAction, conditions, createGame, expToNext, normalizeGame, OFFLINE_FLOORS, stageOf, tick } from '../src/core/game/engine'
import { HOUR } from '../src/core/util'

const T0 = new Date(2026, 10, 3, 10, 0, 0).getTime()

describe('tick', () => {
  it('decays stats over time while awake', () => {
    const g = createGame(T0)
    const after = tick(g, T0 + 2 * HOUR)
    expect(after.stats.satiety).toBeCloseTo(70, 0)
    expect(after.stats.energy).toBeLessThan(g.stats.energy)
    expect(after.stats.cleanliness).toBeLessThan(g.stats.cleanliness)
    expect(after.lastTick).toBe(T0 + 2 * HOUR)
  })

  it('restores energy while asleep and auto-wakes when full', () => {
    const g = { ...createGame(T0), asleep: true, stats: { ...createGame(T0).stats, energy: 20 } }
    const after = tick(g, T0 + 5 * HOUR) // 20 + 16/h * 5h = 100
    expect(after.stats.energy).toBe(100)
    expect(after.asleep).toBe(false)
    expect(tick(g, T0 + 2 * HOUR).asleep).toBe(true)
  })

  it('caps offline catch-up and respects floors', () => {
    const g = createGame(T0)
    const week = tick(g, T0 + 7 * 24 * HOUR, { offline: true, maxOfflineHours: 12 })
    const halfDay = tick(g, T0 + 12 * HOUR, { offline: true, maxOfflineHours: 12 })
    expect(week.stats).toEqual(halfDay.stats)
    for (const k of Object.keys(OFFLINE_FLOORS) as Array<keyof typeof OFFLINE_FLOORS>) {
      expect(week.stats[k]).toBeGreaterThanOrEqual(OFFLINE_FLOORS[k])
    }
  })

  it('neglect online makes the pet sick', () => {
    const g = createGame(T0)
    const after = tick(g, T0 + 40 * HOUR)
    expect(after.stats.satiety).toBe(0)
    expect(conditions(after)).toContain('sick')
  })

  it('harder difficulty decays faster', () => {
    const g = createGame(T0)
    const casual = tick(g, T0 + 4 * HOUR, { difficulty: 'casual' })
    const hard = tick(g, T0 + 4 * HOUR, { difficulty: 'hard' })
    expect(hard.stats.satiety).toBeLessThan(casual.stats.satiety)
  })
})

describe('actions', () => {
  it('feeding consumes the item and raises satiety', () => {
    let g = createGame(T0)
    g = { ...g, stats: { ...g.stats, satiety: 40 } }
    const r = applyAction(g, { type: 'feed', itemId: 'riceball' }, T0)
    expect(r.ok).toBe(true)
    expect(r.state.stats.satiety).toBe(65)
    expect(r.state.inventory.riceball).toBe(2)
    expect(r.anim).toBe('eat')
  })

  it('refuses food when full and medicine when healthy', () => {
    const g = { ...createGame(T0), stats: { ...createGame(T0).stats, satiety: 98 } }
    expect(applyAction(g, { type: 'feed', itemId: 'riceball' }, T0).ok).toBe(false)
    const withMed = { ...g, inventory: { medicine: 1 } }
    expect(applyAction(withMed, { type: 'use', itemId: 'medicine' }, T0).ok).toBe(false)
  })

  it('work pays coins, costs energy and has a cooldown', () => {
    const g = createGame(T0)
    const r = applyAction(g, { type: 'work' }, T0)
    expect(r.ok).toBe(true)
    expect(r.state.coins).toBe(g.coins + 15)
    expect(r.state.stats.energy).toBeLessThan(g.stats.energy)
    const again = applyAction(r.state, { type: 'work' }, T0 + 60_000)
    expect(again.ok).toBe(false)
    expect(again.message).toMatch(/分钟后再来/)
    expect(applyAction(r.state, { type: 'work' }, T0 + 21 * 60_000).ok).toBe(true)
  })

  it('buying deducts coins; toys cannot be bought twice', () => {
    let g = { ...createGame(T0), coins: 200 }
    const r = applyAction(g, { type: 'buy', itemId: 'ball' }, T0)
    expect(r.ok).toBe(true)
    expect(r.state.coins).toBe(150)
    g = r.state
    expect(applyAction(g, { type: 'buy', itemId: 'ball' }, T0).ok).toBe(false)
    expect(applyAction({ ...g, coins: 5 }, { type: 'buy', itemId: 'cake' }, T0).ok).toBe(false)
  })

  it('daily check-in streak', () => {
    const g = createGame(T0)
    const day1 = applyAction(g, { type: 'checkIn' }, T0)
    expect(day1.ok).toBe(true)
    expect(applyAction(day1.state, { type: 'checkIn' }, T0 + HOUR).ok).toBe(false)
    const day2 = applyAction(day1.state, { type: 'checkIn' }, T0 + 24 * HOUR)
    expect(day2.state.checkInStreak).toBe(2)
    const gap = applyAction(day2.state, { type: 'checkIn' }, T0 + 4 * 24 * HOUR)
    expect(gap.state.checkInStreak).toBe(1)
  })

  it('petting has diminishing returns when spammed and a daily affection cap', () => {
    let g = createGame(T0)
    const first = applyAction(g, { type: 'pet' }, T0)
    expect(first.delta.affection).toBe(2)
    const spam = applyAction(first.state, { type: 'pet' }, T0 + 500)
    expect(spam.delta.affection).toBeUndefined()
    g = first.state
    let t = T0
    for (let i = 0; i < 40; i++) {
      t += 5_000
      g = applyAction(g, { type: 'pet' }, t).state
    }
    expect(g.affection).toBeLessThanOrEqual(40)
  })

  it('levels up and changes stage', () => {
    let g = createGame(T0)
    expect(stageOf(g.level)).toBe('baby')
    g = { ...g, exp: expToNext(1) - 1 }
    const r = applyAction(g, { type: 'pet' }, T0)
    expect(r.leveledUp).toBe(2)
    expect(r.state.level).toBe(2)
    expect(stageOf(5)).toBe('child')
    expect(stageOf(15)).toBe('adult')
  })

  it('sleep / wake rules', () => {
    const g = createGame(T0)
    expect(applyAction(g, { type: 'sleep' }, T0).ok).toBe(false) // energy 90, not sleepy
    const tired = { ...g, stats: { ...g.stats, energy: 40 } }
    const slept = applyAction(tired, { type: 'sleep' }, T0)
    expect(slept.state.asleep).toBe(true)
    expect(applyAction(slept.state, { type: 'play' }, T0).ok).toBe(false)
    expect(applyAction(slept.state, { type: 'wake' }, T0).state.asleep).toBe(false)
  })

  it('normalizeGame fills missing fields from old saves', () => {
    const g = normalizeGame({ coins: 7, stats: { satiety: 10 } } as never, T0)
    expect(g.coins).toBe(7)
    expect(g.stats.satiety).toBe(10)
    expect(g.stats.mood).toBe(75)
    expect(g.totals.studied).toBe(0)
  })
})
