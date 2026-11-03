import { describe, expect, it } from 'vitest'
import { EmotionStreamParser } from '../src/core/ai/emotion'
import { buildSystemPrompt } from '../src/core/ai/prompt'
import { applyAction, createGame } from '../src/core/game/engine'
import { DEFAULT_PERSONA } from '../src/core/persona/persona'
import {
  addReminder,
  addTodo,
  describeDue,
  describeTasksForPrompt,
  emptyTasks,
  fireDue,
  nextOccurrence,
  normalizeTasks,
  parseActionTags,
  parseWhen
} from '../src/core/tasks'

const NOW = new Date(2026, 10, 3, 20, 15).getTime() // Tue 20:15
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime()

describe('parseWhen', () => {
  it('relative times', () => {
    expect(parseWhen('+30m', NOW)).toEqual({ dueAt: NOW + 30 * 60_000, repeat: 'none' })
    expect(parseWhen('2小时后', NOW)).toEqual({ dueAt: NOW + 2 * 3_600_000, repeat: 'none' })
    expect(parseWhen('+1d', NOW)?.dueAt).toBe(NOW + 86_400_000)
    expect(parseWhen('+0m', NOW)).toBeNull()
  })

  it('absolute and clock times', () => {
    expect(parseWhen('2026-11-04 09:30', NOW)?.dueAt).toBe(at(4, 9, 30))
    expect(parseWhen('2026-11-04T09:30', NOW)?.dueAt).toBe(at(4, 9, 30))
    expect(parseWhen('21:00', NOW)?.dueAt).toBe(at(3, 21))
    expect(parseWhen('08:00', NOW)?.dueAt).toBe(at(4, 8)) // already passed today -> tomorrow
    expect(parseWhen('明天 9:00', NOW)?.dueAt).toBe(at(4, 9))
    expect(parseWhen('后天 07：30', NOW)?.dueAt).toBe(at(5, 7, 30))
    expect(parseWhen('25:00', NOW)).toBeNull()
    expect(parseWhen('sometime', NOW)).toBeNull()
  })

  it('repeating', () => {
    expect(parseWhen('每天 08:00', NOW)).toEqual({ dueAt: at(4, 8), repeat: 'daily' })
    expect(parseWhen('每天 22:00', NOW)).toEqual({ dueAt: at(3, 22), repeat: 'daily' })
    expect(parseWhen('每周 09:00', NOW)).toEqual({ dueAt: at(10, 9), repeat: 'weekly' })
  })
})

describe('action tags', () => {
  it('extracts reminders and todos and strips them', () => {
    const r = parseActionTags('好哒，到时候叫你~[[remind|+20m|喝水]]\n[[todo|周五交报告]][[bogus|x]]', NOW)
    expect(r.text).toBe('好哒，到时候叫你~')
    expect(r.actions).toEqual([
      { kind: 'remind', text: '喝水', dueAt: NOW + 20 * 60_000, repeat: 'none' },
      { kind: 'todo', text: '周五交报告' }
    ])
    expect(r.invalid).toEqual(['bogus|x'])
  })

  it('stream parser hides action tags split across chunks', () => {
    const p = new EmotionStreamParser()
    let out = ''
    for (const d of ['[happy]好', '哒~[[re', 'mind|2026-11-03 ', '21:00|喝', '水]] 别忘啦']) out += p.push(d).text
    out += p.flush().text
    expect(out).toBe('好哒~ 别忘啦')
  })
})

describe('reminders', () => {
  it('fires one-shot and advances repeating reminders', () => {
    let st = emptyTasks()
    st = addReminder(st, { text: '喝水', dueAt: NOW - 1000 }, NOW).state
    st = addReminder(st, { text: '吃早饭', dueAt: at(3, 8), repeat: 'daily' }, NOW).state
    st = addReminder(st, { text: '睡觉', dueAt: at(3, 23) }, NOW).state
    const { state, fired } = fireDue(st, NOW)
    expect(fired.map((r) => r.text).sort()).toEqual(['吃早饭', '喝水'])
    expect(state.reminders.find((r) => r.text === '喝水')?.done).toBe(true)
    expect(state.reminders.find((r) => r.text === '吃早饭')?.dueAt).toBe(at(4, 8))
    expect(state.reminders.find((r) => r.text === '睡觉')?.done).toBe(false)
    expect(fireDue(state, NOW).fired).toHaveLength(0)
  })

  it('nextOccurrence skips missed days', () => {
    expect(nextOccurrence(at(1, 8), 'daily', NOW)).toBe(at(4, 8))
    expect(nextOccurrence(at(1, 8), 'weekly', NOW)).toBe(at(8, 8))
  })

  it('describes due times and tasks for the prompt', () => {
    expect(describeDue(at(3, 21), NOW)).toBe('今天 21:00')
    expect(describeDue(at(4, 9, 5), NOW)).toBe('明天 09:05')
    let st = addReminder(emptyTasks(), { text: '喝水', dueAt: at(3, 21) }, NOW).state
    st = addTodo(st, '买牛奶', 'user', NOW).state
    const desc = describeTasksForPrompt(st, NOW)
    expect(desc).toContain('今天 21:00 喝水')
    expect(desc).toContain('待办：买牛奶')
    const sys = buildSystemPrompt({ persona: DEFAULT_PERSONA, game: createGame(NOW), coreMemories: [], relevantMemories: [], now: new Date(NOW), tasks: desc })
    expect(sys).toContain('买牛奶')
    expect(sys).toContain('[[remind|')
  })

  it('normalizes bad data', () => {
    expect(normalizeTasks({ reminders: [{ text: 'x' }, null], todos: 'no', focus: { endsAt: 5 } })).toEqual({ reminders: [], todos: [], focus: { endsAt: 5 } })
    expect(normalizeTasks(undefined)).toEqual(emptyTasks())
  })
})

describe('focus reward', () => {
  it('pays coins and exp proportional to minutes', () => {
    const g = createGame(NOW)
    const r = applyAction(g, { type: 'focus', minutes: 25 }, NOW)
    expect(r.ok).toBe(true)
    expect(r.state.coins).toBe(g.coins + 20)
    expect(r.state.totals.focusMinutes).toBe(25)
    expect(r.state.stats.energy).toBeLessThan(g.stats.energy)
  })
})
