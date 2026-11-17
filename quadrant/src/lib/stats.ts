import { addDays, diffDays, startOfWeek, toISODate } from './date';
import { QUADRANT_IDS } from './quadrants';
import type { QuadrantId, Task } from './types';

export type QCount = Record<QuadrantId, number>;

const zero = (): QCount => ({ q1: 0, q2: 0, q3: 0, q4: 0 });

export interface DayBucket {
  date: string;
  counts: QCount;
  total: number;
}

export interface Stats {
  open: QCount;
  openTotal: number;
  overdue: number;
  dueToday: number;
  doneToday: number;
  doneThisWeek: number;
  doneLastWeek: number;
  /** 最近 N 天每天完成数，按象限拆分 */
  daily: DayBucket[];
  /** 最近 N 天完成数按象限汇总 */
  doneByQuadrant: QCount;
  doneInRange: number;
  /** 当前连续有完成任务的天数（含今天；今天还没完成则从昨天算起） */
  streak: number;
  topTags: { tag: string; open: number; done: number }[];
}

export function computeStats(tasks: Task[], today: string, days = 14): Stats {
  const open = zero();
  const doneByQuadrant = zero();
  let overdue = 0;
  let dueToday = 0;
  let doneToday = 0;
  let doneThisWeek = 0;
  let doneLastWeek = 0;
  const weekStart = startOfWeek(today);
  const lastWeekStart = addDays(weekStart, -7);
  const rangeStart = addDays(today, -(days - 1));
  const daily: DayBucket[] = Array.from({ length: days }, (_, i) => ({
    date: addDays(rangeStart, i),
    counts: zero(),
    total: 0,
  }));
  const doneDays = new Set<string>();
  const tagMap = new Map<string, { open: number; done: number }>();

  for (const t of tasks) {
    for (const tag of t.tags) {
      const e = tagMap.get(tag) ?? { open: 0, done: 0 };
      if (t.done) e.done++;
      else e.open++;
      tagMap.set(tag, e);
    }
    if (!t.done) {
      open[t.quadrant]++;
      if (t.due) {
        const d = diffDays(today, t.due);
        if (d < 0) overdue++;
        else if (d === 0) dueToday++;
      }
      continue;
    }
    if (!t.completedAt) continue;
    const day = toISODate(new Date(t.completedAt));
    doneDays.add(day);
    if (day === today) doneToday++;
    if (day >= weekStart && day <= today) doneThisWeek++;
    else if (day >= lastWeekStart && day < weekStart) doneLastWeek++;
    if (day >= rangeStart && day <= today) {
      const idx = diffDays(rangeStart, day);
      daily[idx].counts[t.quadrant]++;
      daily[idx].total++;
      doneByQuadrant[t.quadrant]++;
    }
  }

  let streak = 0;
  let cursor = doneDays.has(today) ? today : addDays(today, -1);
  while (doneDays.has(cursor) && streak < 3650) {
    streak++;
    cursor = addDays(cursor, -1);
  }

  const topTags = [...tagMap.entries()]
    .map(([tag, v]) => ({ tag, ...v }))
    .sort((a, b) => b.open + b.done - (a.open + a.done))
    .slice(0, 8);

  return {
    open,
    openTotal: QUADRANT_IDS.reduce((s, q) => s + open[q], 0),
    overdue,
    dueToday,
    doneToday,
    doneThisWeek,
    doneLastWeek,
    daily,
    doneByQuadrant,
    doneInRange: QUADRANT_IDS.reduce((s, q) => s + doneByQuadrant[q], 0),
    streak,
    topTags,
  };
}

export interface Insight {
  tone: 'good' | 'warn' | 'info';
  text: string;
}

/** 根据四象限法则给出建议 */
export function buildInsights(s: Stats): Insight[] {
  const out: Insight[] = [];
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
  if (s.overdue > 0) out.push({ tone: 'warn', text: `有 ${s.overdue} 项任务已逾期，先处理它们或重新安排日期。` });
  if (s.doneInRange >= 4) {
    const q2 = pct(s.doneByQuadrant.q2, s.doneInRange);
    const q1 = pct(s.doneByQuadrant.q1, s.doneInRange);
    const q34 = pct(s.doneByQuadrant.q3 + s.doneByQuadrant.q4, s.doneInRange);
    if (q2 >= 40) out.push({ tone: 'good', text: `最近完成的任务里 ${q2}% 来自第二象限，你在把时间花在重要的事情上。` });
    else out.push({ tone: 'info', text: `第二象限只占最近完成的 ${q2}%。试着每天先安排一件“重要但不紧急”的事。` });
    if (q1 >= 50) out.push({ tone: 'warn', text: `${q1}% 的完成来自第一象限，经常在救火。把更多事情提前规划到第二象限，能减少紧急情况。` });
    if (q34 >= 40) out.push({ tone: 'warn', text: `${q34}% 的精力花在了不重要的事上。第三象限可以委托，第四象限可以删减。` });
  }
  if (s.open.q1 > 7) out.push({ tone: 'warn', text: `“立即做”里堆了 ${s.open.q1} 项。真正同时紧急又重要的事通常不多，重新评估一下。` });
  if (s.open.q4 > 5) out.push({ tone: 'info', text: `第四象限有 ${s.open.q4} 项未完成，考虑直接删掉一些。` });
  if (s.streak >= 3) out.push({ tone: 'good', text: `已连续 ${s.streak} 天完成任务，保持节奏。` });
  if (!out.length) out.push({ tone: 'info', text: '完成更多任务后，这里会根据你的四象限分布给出建议。' });
  return out.slice(0, 4);
}
