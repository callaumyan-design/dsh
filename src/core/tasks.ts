/**
 * Reminders, todos and focus (pomodoro) sessions — pure logic.
 *
 * The LLM can create them with provider-agnostic inline tags that are stripped from the
 * visible reply:
 *   [[remind|2026-11-03 21:00|喝水]]   [[remind|+30m|站起来活动一下]]   [[remind|每天 08:00|吃早饭]]
 *   [[todo|周五前交报告]]
 */
import { dateKey, uid } from './util'

export type Repeat = 'none' | 'daily' | 'weekly'

export interface Reminder {
  id: string
  text: string
  dueAt: number
  repeat: Repeat
  createdAt: number
  done: boolean
  lastFiredAt?: number
  source: 'user' | 'ai'
}

export interface Todo {
  id: string
  text: string
  done: boolean
  createdAt: number
  doneAt?: number
  source: 'user' | 'ai'
}

export interface FocusSession {
  startedAt: number
  endsAt: number
  minutes: number
  label: string
}

export interface TasksState {
  reminders: Reminder[]
  todos: Todo[]
  focus: FocusSession | null
}

export function emptyTasks(): TasksState {
  return { reminders: [], todos: [], focus: null }
}

export function normalizeTasks(raw: unknown): TasksState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<TasksState>
  return {
    reminders: Array.isArray(r.reminders) ? r.reminders.filter((x) => x && typeof x.text === 'string' && typeof x.dueAt === 'number') : [],
    todos: Array.isArray(r.todos) ? r.todos.filter((x) => x && typeof x.text === 'string') : [],
    focus: r.focus && typeof r.focus.endsAt === 'number' ? r.focus : null
  }
}

const DAY = 86_400_000

/** Advance a repeating reminder past `now`. */
export function nextOccurrence(dueAt: number, repeat: Repeat, now: number): number {
  if (repeat === 'none') return dueAt
  const step = repeat === 'daily' ? DAY : 7 * DAY
  let t = dueAt
  while (t <= now) t += step
  return t
}

export function dueReminders(state: TasksState, now: number): Reminder[] {
  return state.reminders.filter((r) => !r.done && r.dueAt <= now)
}

/** Mark due reminders fired (one-shot -> done, repeating -> next occurrence). */
export function fireDue(state: TasksState, now: number): { state: TasksState; fired: Reminder[] } {
  const fired: Reminder[] = []
  const reminders = state.reminders.map((r) => {
    if (r.done || r.dueAt > now) return r
    fired.push(r)
    return r.repeat === 'none' ? { ...r, done: true, lastFiredAt: now } : { ...r, lastFiredAt: now, dueAt: nextOccurrence(r.dueAt, r.repeat, now) }
  })
  // keep the list tidy: drop finished one-shots older than 7 days
  const kept = reminders.filter((r) => !(r.done && (r.lastFiredAt ?? r.dueAt) < now - 7 * DAY))
  return { state: { ...state, reminders: kept }, fired }
}

export function addReminder(state: TasksState, input: { text: string; dueAt: number; repeat?: Repeat; source?: 'user' | 'ai' }, now: number): { state: TasksState; reminder: Reminder } {
  const reminder: Reminder = {
    id: uid('r'),
    text: input.text.trim(),
    dueAt: input.dueAt,
    repeat: input.repeat ?? 'none',
    createdAt: now,
    done: false,
    source: input.source ?? 'user'
  }
  return { state: { ...state, reminders: [...state.reminders, reminder].sort((a, b) => a.dueAt - b.dueAt) }, reminder }
}

export function addTodo(state: TasksState, text: string, source: 'user' | 'ai', now: number): { state: TasksState; todo: Todo } {
  const todo: Todo = { id: uid('t'), text: text.trim(), done: false, createdAt: now, source }
  return { state: { ...state, todos: [...state.todos, todo] }, todo }
}

// ---------------------------------------------------------------- time parsing

const pad = (n: number) => String(n).padStart(2, '0')

export function formatDateTime(ts: number): string {
  const d = new Date(ts)
  return `${dateKey(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Human-friendly "今天 21:00" / "明天 08:30" / "11-05 09:00". */
export function describeDue(ts: number, now: number): string {
  const d = new Date(ts)
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const today = dateKey(now)
  const tomorrow = dateKey(now + DAY)
  const key = dateKey(ts)
  if (key === today) return `今天 ${hm}`
  if (key === tomorrow) return `明天 ${hm}`
  return `${key.slice(5)} ${hm}`
}

export interface ParsedWhen {
  dueAt: number
  repeat: Repeat
}

/**
 * Parse the time field of a [[remind|...]] tag. Accepted forms:
 *   2026-11-03 21:00 · 2026-11-03T21:00 · 21:00 (today, or tomorrow if passed) · 明天 09:00 · 后天 9:00
 *   +30m / +2h / +1d · 30分钟后 / 2小时后 · 每天 08:00 · 每周 09:00 (same weekday as today)
 */
export function parseWhen(input: string, now: number): ParsedWhen | null {
  const s = input.trim().replace(/：/g, ':')
  let m: RegExpExecArray | null

  if ((m = /^\+?\s*(\d+(?:\.\d+)?)\s*(m|min|分钟|h|小时|d|天)\s*(后)?$/i.exec(s))) {
    const n = Number(m[1])
    const unit = m[2].toLowerCase()
    const ms = unit === 'm' || unit === 'min' || unit === '分钟' ? 60_000 : unit === 'h' || unit === '小时' ? 3_600_000 : DAY
    if (!(n > 0)) return null
    return { dueAt: now + Math.round(n * ms), repeat: 'none' }
  }

  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})$/.exec(s))) {
    const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime()
    return Number.isNaN(t) ? null : { dueAt: t, repeat: 'none' }
  }

  let repeat: Repeat = 'none'
  let dayOffset = 0
  let rest = s
  if ((m = /^(每天|每日|daily)\s*/i.exec(rest))) {
    repeat = 'daily'
    rest = rest.slice(m[0].length)
  } else if ((m = /^(每周|weekly)\s*/i.exec(rest))) {
    repeat = 'weekly'
    rest = rest.slice(m[0].length)
  } else if ((m = /^(今天|明天|后天)\s*/.exec(rest))) {
    dayOffset = { 今天: 0, 明天: 1, 后天: 2 }[m[1] as '今天' | '明天' | '后天']
    rest = rest.slice(m[0].length)
  }
  if ((m = /^(\d{1,2}):(\d{2})$/.exec(rest))) {
    const h = Number(m[1])
    const min = Number(m[2])
    if (h > 23 || min > 59) return null
    const d = new Date(now)
    d.setHours(h, min, 0, 0)
    d.setDate(d.getDate() + dayOffset)
    let t = d.getTime()
    if (t <= now && dayOffset === 0) t = repeat === 'weekly' ? t + 7 * DAY : t + DAY
    return { dueAt: t, repeat }
  }
  return null
}

// ---------------------------------------------------------------- action tags

export type PetActionTag =
  | { kind: 'remind'; text: string; dueAt: number; repeat: Repeat }
  | { kind: 'todo'; text: string }

export const ACTION_TAG_RE = /\[\[([^[\]]{1,240})\]\]/g

/** Extract [[remind|...]] / [[todo|...]] tags and return the text without them. */
export function parseActionTags(text: string, now: number): { text: string; actions: PetActionTag[]; invalid: string[] } {
  const actions: PetActionTag[] = []
  const invalid: string[] = []
  const clean = text.replace(ACTION_TAG_RE, (_full, body: string) => {
    const parts = body.split('|').map((p) => p.trim())
    const kind = parts[0]?.toLowerCase()
    if ((kind === 'remind' || kind === '提醒') && parts.length >= 3) {
      const when = parseWhen(parts[1], now)
      const what = parts.slice(2).join('|').trim()
      if (when && what) actions.push({ kind: 'remind', text: what, ...when })
      else invalid.push(body)
    } else if ((kind === 'todo' || kind === '待办') && parts[1]) {
      actions.push({ kind: 'todo', text: parts.slice(1).join('|').trim() })
    } else {
      invalid.push(body)
    }
    return ''
  })
  return { text: clean.replace(/[ \t]+\n/g, '\n').trim(), actions, invalid }
}

/** Lines for the system prompt so the pet knows what it is keeping track of. */
export function describeTasksForPrompt(state: TasksState, now: number): string {
  const upcoming = state.reminders.filter((r) => !r.done).slice(0, 5)
  const todos = state.todos.filter((t) => !t.done).slice(0, 5)
  const lines: string[] = []
  for (const r of upcoming) lines.push(`- 提醒：${describeDue(r.dueAt, now)} ${r.text}${r.repeat !== 'none' ? (r.repeat === 'daily' ? '（每天）' : '（每周）') : ''}`)
  for (const t of todos) lines.push(`- 待办：${t.text}`)
  if (state.focus && state.focus.endsAt > now) lines.push(`- 用户正在专注（番茄钟），还剩 ${Math.ceil((state.focus.endsAt - now) / 60_000)} 分钟`)
  return lines.join('\n')
}
