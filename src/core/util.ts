export const HOUR = 3_600_000
export const DAY = 24 * HOUR

export function clamp(v: number, min = 0, max = 100): number {
  if (Number.isNaN(v)) return min
  return Math.min(max, Math.max(min, v))
}

export function round1(v: number): number {
  return Math.round(v * 10) / 10
}

/** Local calendar date as YYYY-MM-DD. */
export function dateKey(ts: number | Date): string {
  const d = typeof ts === 'number' ? new Date(ts) : ts
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function previousDateKey(ts: number): string {
  const d = new Date(ts)
  d.setDate(d.getDate() - 1)
  return dateKey(d)
}

let counter = 0
export function uid(prefix = 'id'): string {
  counter = (counter + 1) % 1_000_000
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${counter.toString(36)}`
}

/** "HH:MM" -> minutes since midnight. Returns NaN for invalid input. */
export function parseHHMM(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!m) return NaN
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return NaN
  return h * 60 + min
}

/** Whether `now` falls inside [start, end) where the window may wrap past midnight. */
export function inTimeWindow(now: Date, start: string, end: string): boolean {
  const s = parseHHMM(start)
  const e = parseHHMM(end)
  if (Number.isNaN(s) || Number.isNaN(e) || s === e) return false
  const cur = now.getHours() * 60 + now.getMinutes()
  return s < e ? cur >= s && cur < e : cur >= s || cur < e
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

export function describeTime(now: Date): string {
  const h = now.getHours()
  const part =
    h < 5 ? '凌晨' : h < 8 ? '清晨' : h < 11 ? '上午' : h < 13 ? '中午' : h < 18 ? '下午' : h < 22 ? '晚上' : '深夜'
  const mm = String(now.getMinutes()).padStart(2, '0')
  return `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 星期${WEEKDAYS[now.getDay()]} ${part} ${h}:${mm}`
}

/** Rough token estimate when a provider does not report usage. CJK ≈ 1 token/char, latin ≈ 4 chars/token. */
export function estimateTokens(text: string): number {
  let cjk = 0
  for (const ch of text) if (/[　-鿿＀-￯]/.test(ch)) cjk++
  return Math.ceil(cjk + (text.length - cjk) / 4)
}
