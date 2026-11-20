// ISO 周（周一开始）。期号用 “2026-W47” 这样的形式，文件名和网址都用它。

/** 返回某个日期所在 ISO 周的 { year, week, id, monday, sunday }（日期均为 UTC）。 */
export function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7; // 周日 = 7
  d.setUTCDate(d.getUTCDate() + 4 - day); // 移到本周四，ISO 年以周四所在年份为准
  const year = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - 3);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { year, week, id: `${year}-W${String(week).padStart(2, '0')}`, monday, sunday };
}

/**
 * Trending 周榜统计的是“过去 7 天”。出刊时刻 publishedAt 对应的统计区间是
 * [publishedAt 前 7 天, publishedAt 前 1 天]，期号取区间最后一天所在的 ISO 周。
 * 每周一出刊时，区间正好是上周一到上周日。
 */
export function reviewWindow(publishedAt = new Date()) {
  const day = 86400000;
  const end = new Date(publishedAt.getTime() - day);
  const start = new Date(publishedAt.getTime() - 7 * day);
  return { id: isoWeek(end).id, start, end };
}

const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export const zhDate = (d) => `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
export const zhShort = (d) => `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
