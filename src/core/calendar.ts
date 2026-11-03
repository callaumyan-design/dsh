/**
 * Festivals and anniversaries the pet knows about. Lunar-calendar festivals use a lookup
 * table (2026–2030); extend LUNAR when needed.
 */
import { DAY, dateKey } from './util'

export interface SpecialDay {
  id: string
  name: string
  greeting: string
}

const FIXED: Record<string, SpecialDay> = {
  '01-01': { id: 'newyear', name: '元旦', greeting: '新年快乐！新的一年也请多多关照~' },
  '02-14': { id: 'valentine', name: '情人节', greeting: '今天是情人节哦，送你一颗小心心 ❤' },
  '03-08': { id: 'women', name: '妇女节', greeting: '今天是妇女节~' },
  '04-01': { id: 'april', name: '愚人节', greeting: '今天是愚人节，我才不会骗你呢……大概' },
  '05-01': { id: 'labor', name: '劳动节', greeting: '劳动节快乐！今天要好好休息哦' },
  '06-01': { id: 'children', name: '儿童节', greeting: '儿童节快乐！今天我们都是小朋友~' },
  '10-01': { id: 'national', name: '国庆节', greeting: '国庆节快乐！假期要好好玩~' },
  '10-31': { id: 'halloween', name: '万圣节前夜', greeting: '不给糖就捣蛋！🎃' },
  '12-24': { id: 'xmas-eve', name: '平安夜', greeting: '平安夜快乐，今晚要平平安安的~' },
  '12-25': { id: 'xmas', name: '圣诞节', greeting: '圣诞快乐！🎄' }
}

/** Lunar festivals by Gregorian date. 除夕 is derived as the day before 春节. */
const LUNAR: Record<number, { spring: string; dragon: string; qixi: string; midautumn: string }> = {
  2026: { spring: '02-17', dragon: '06-19', qixi: '08-19', midautumn: '09-25' },
  2027: { spring: '02-06', dragon: '06-09', qixi: '08-08', midautumn: '09-15' },
  2028: { spring: '01-26', dragon: '05-28', qixi: '08-26', midautumn: '10-03' },
  2029: { spring: '02-13', dragon: '06-16', qixi: '08-16', midautumn: '09-22' },
  2030: { spring: '02-03', dragon: '06-05', qixi: '08-05', midautumn: '09-12' }
}

function md(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function shift(year: number, mmdd: string, days: number): string {
  const [m, d] = mmdd.split('-').map(Number)
  return md(new Date(new Date(year, m - 1, d).getTime() + days * DAY))
}

export function festivalOn(date: Date): SpecialDay | null {
  const key = md(date)
  const y = date.getFullYear()
  const l = LUNAR[y]
  if (l) {
    if (key === shift(y, l.spring, -1)) return { id: 'chuxi', name: '除夕', greeting: '今天是除夕！一起守岁吧，新年快乐~' }
    if (key === l.spring) return { id: 'spring', name: '春节', greeting: '过年好！恭喜发财，红包拿来~ 🧧' }
    if (key === shift(y, l.spring, 14)) return { id: 'lantern', name: '元宵节', greeting: '元宵节快乐！今天要吃汤圆哦' }
    if (key === l.dragon) return { id: 'dragon', name: '端午节', greeting: '端午安康！粽子要甜的还是咸的？' }
    if (key === l.qixi) return { id: 'qixi', name: '七夕', greeting: '今天是七夕~ 有我陪着你呢' }
    if (key === l.midautumn) return { id: 'midautumn', name: '中秋节', greeting: '中秋快乐！今晚的月亮一定很圆 🥮' }
  }
  return FIXED[key] ?? null
}

/** "我们认识 100 天" style milestones, counted from the pet's creation date. */
export function anniversaryOn(date: Date, createdAt: number): SpecialDay | null {
  const start = new Date(createdAt)
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime()
  const today = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const days = Math.round((today - startDay) / DAY)
  if (days <= 0) return null
  if (md(date) === md(start)) {
    const years = date.getFullYear() - start.getFullYear()
    if (years > 0) return { id: `anniv-${years}y`, name: `相识 ${years} 周年`, greeting: `今天是我们认识 ${years} 周年的日子！谢谢你一直陪着我~` }
  }
  if ([7, 30, 100, 200, 365, 500, 1000].includes(days)) {
    return { id: `anniv-${days}d`, name: `相识 ${days} 天`, greeting: `我们已经认识 ${days} 天啦！` }
  }
  return null
}

/** Lines for the system prompt. */
export function describeSpecialDays(now: Date, createdAt: number): string[] {
  const out: string[] = []
  const f = festivalOn(now)
  if (f) out.push(`今天是${f.name}。`)
  const a = anniversaryOn(now, createdAt)
  if (a) out.push(`今天是你和对方${a.name}的纪念日。`)
  return out
}

export function specialGreeting(now: Date, createdAt: number): { key: string; text: string } | null {
  const a = anniversaryOn(now, createdAt)
  const f = festivalOn(now)
  const day = a ?? f
  return day ? { key: `${dateKey(now)}:${day.id}`, text: day.greeting } : null
}
