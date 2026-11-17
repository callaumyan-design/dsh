/** 所有日期均使用本地时区的 YYYY-MM-DD 字符串表示，避免时区偏移问题 */

const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function isISODate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = parseISODate(s);
  return toISODate(d) === s;
}

export function todayISO(now: Date = new Date()): string {
  return toISODate(now);
}

export function addDays(iso: string, n: number): string {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

export function addMonths(iso: string, n: number): string {
  const d = parseISODate(iso);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toISODate(d);
}

/** b - a 的天数 */
export function diffDays(a: string, b: string): number {
  const ms = parseISODate(b).getTime() - parseISODate(a).getTime();
  return Math.round(ms / 86400000);
}

/** 0=周日 … 6=周六 */
export function weekdayOf(iso: string): number {
  return parseISODate(iso).getDay();
}

export const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'];

/** 本周一 */
export function startOfWeek(iso: string): string {
  const wd = weekdayOf(iso);
  const offset = wd === 0 ? -6 : 1 - wd;
  return addDays(iso, offset);
}

export function formatDue(due: string, today: string, dueTime?: string): string {
  const diff = diffDays(today, due);
  let label: string;
  if (diff === 0) label = '今天';
  else if (diff === 1) label = '明天';
  else if (diff === 2) label = '后天';
  else if (diff === -1) label = '昨天';
  else if (diff > 2 && diff < 7) label = `周${WEEKDAY_CN[weekdayOf(due)]}`;
  else {
    const d = parseISODate(due);
    const t = parseISODate(today);
    label =
      d.getFullYear() === t.getFullYear()
        ? `${d.getMonth() + 1}月${d.getDate()}日`
        : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  }
  return dueTime ? `${label} ${dueTime}` : label;
}

export function formatDateLong(iso: string): string {
  const d = parseISODate(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日 周${WEEKDAY_CN[d.getDay()]}`;
}

export type DueStatus = 'overdue' | 'today' | 'soon' | 'later' | 'none';

export function dueStatus(due: string | undefined, today: string, soonDays = 2): DueStatus {
  if (!due) return 'none';
  const diff = diffDays(today, due);
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  if (diff <= soonDays) return 'soon';
  return 'later';
}
