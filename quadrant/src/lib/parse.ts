import { addDays, diffDays, formatDue, isISODate, parseISODate, startOfWeek, toISODate, weekdayOf } from './date';
import { QMAP, quadrantOf } from './quadrants';
import { REPEAT_LABEL } from './recurrence';
import type { QuadrantId, Repeat } from './types';

export interface ParsedToken {
  kind: 'tag' | 'delegate' | 'quadrant' | 'date' | 'time' | 'repeat';
  label: string;
}

export interface ParsedInput {
  title: string;
  tags: string[];
  delegate?: string;
  quadrant?: QuadrantId;
  due?: string;
  dueTime?: string;
  repeat?: Repeat;
  tokens: ParsedToken[];
}

const CN_DIGIT: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

/** 解析 0–99 的阿拉伯数字或中文数字 */
function num(s: string): number {
  if (/^\d+$/.test(s)) return Number(s);
  if (s.length === 1) return CN_DIGIT[s] ?? NaN;
  if (s.startsWith('十')) return 10 + (CN_DIGIT[s[1]] ?? NaN);
  if (s.endsWith('十')) return (CN_DIGIT[s[0]] ?? NaN) * 10;
  if (s.length === 3 && s[1] === '十') return (CN_DIGIT[s[0]] ?? NaN) * 10 + (CN_DIGIT[s[2]] ?? NaN);
  return NaN;
}

const WD: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0, '7': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6 };

/** 周一为一周的开始，返回本周某天 */
function dayInWeek(weekStart: string, wd: number): string {
  return addDays(weekStart, wd === 0 ? 6 : wd - 1);
}

const NUM = '(\\d{1,2}|[零〇一二两三四五六七八九十]{1,3})';
const pad = (n: number) => String(n).padStart(2, '0');

type Rule = { re: RegExp; multi?: boolean; apply: (m: RegExpExecArray, ctx: Ctx) => boolean };

interface Ctx {
  today: string;
  out: ParsedInput;
  important?: boolean;
  urgent?: boolean;
  evening?: boolean;
}

function setDate(ctx: Ctx, iso: string): boolean {
  if (ctx.out.due || !isISODate(iso)) return false;
  ctx.out.due = iso;
  return true;
}

function setTime(ctx: Ctx, h: number, m: number): boolean {
  if (ctx.out.dueTime || !(h >= 0 && h <= 23 && m >= 0 && m <= 59)) return false;
  ctx.out.dueTime = `${pad(h)}:${pad(m)}`;
  return true;
}

function mdToDate(ctx: Ctx, month: number, day: number, year?: number): string {
  const t = parseISODate(ctx.today);
  const y = year ?? t.getFullYear();
  const d = new Date(y, month - 1, day);
  if (d.getMonth() !== month - 1) return '';
  let iso = toISODate(d);
  // 未写年份且日期已过，视为明年
  if (year === undefined && diffDays(ctx.today, iso) < 0) iso = toISODate(new Date(y + 1, month - 1, day));
  return iso;
}

const RULES: Rule[] = [
  // ---- 标签 / 委托 ----
  {
    re: /(?:^|\s)#([^\s#@!！]+)/,
    multi: true,
    apply: (m, ctx) => {
      const tag = m[1];
      if (!ctx.out.tags.includes(tag)) ctx.out.tags.push(tag);
      return true;
    },
  },
  {
    re: /(?:^|\s)@([^\s#@!！]+)/,
    apply: (m, ctx) => {
      if (ctx.out.delegate) return false;
      ctx.out.delegate = m[1];
      return true;
    },
  },
  // ---- 象限 ----
  {
    re: /[!！][qQ]?([1-4])(?![0-9])/,
    apply: (m, ctx) => {
      if (ctx.out.quadrant) return false;
      ctx.out.quadrant = `q${m[1]}` as QuadrantId;
      return true;
    },
  },
  { re: /[!！]重要/, apply: (_m, ctx) => ((ctx.important = true), true) },
  { re: /[!！]紧急/, apply: (_m, ctx) => ((ctx.urgent = true), true) },
  // ---- 重复 ----
  { re: /每个?工作日/, apply: (_m, ctx) => setRepeat(ctx, 'weekdays') },
  {
    re: /每(?:个)?(?:周|星期|礼拜)([一二三四五六日天1-7])?/,
    apply: (m, ctx) => {
      if (!setRepeat(ctx, 'weekly')) return false;
      if (m[1]) {
        const wd = WD[m[1]];
        let d = dayInWeek(startOfWeek(ctx.today), wd);
        if (d < ctx.today) d = addDays(d, 7);
        setDate(ctx, d);
      }
      return true;
    },
  },
  {
    re: new RegExp(`每(?:个)?月(?:${NUM}[号日])?`),
    apply: (m, ctx) => {
      if (!setRepeat(ctx, 'monthly')) return false;
      if (m[1]) {
        const day = num(m[1]);
        if (day >= 1 && day <= 31) {
          const t = parseISODate(ctx.today);
          let d = new Date(t.getFullYear(), t.getMonth(), day);
          if (d.getMonth() !== t.getMonth() || toISODate(d) < ctx.today) d = new Date(t.getFullYear(), t.getMonth() + 1, day);
          setDate(ctx, toISODate(d));
        }
      }
      return true;
    },
  },
  { re: /每天|每日/, apply: (_m, ctx) => setRepeat(ctx, 'daily') },
  // ---- 日期 ----
  {
    re: /(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})[日号]?/,
    apply: (m, ctx) => setDate(ctx, mdToDate(ctx, Number(m[2]), Number(m[3]), Number(m[1]))),
  },
  {
    re: new RegExp(`${NUM}月${NUM}[日号]?`),
    apply: (m, ctx) => setDate(ctx, mdToDate(ctx, num(m[1]), num(m[2]))),
  },
  {
    re: /(?<![\d/])(\d{1,2})\/(\d{1,2})(?![\d/])/,
    apply: (m, ctx) => setDate(ctx, mdToDate(ctx, Number(m[1]), Number(m[2]))),
  },
  { re: /大后天/, apply: (_m, ctx) => setDate(ctx, addDays(ctx.today, 3)) },
  { re: /后天/, apply: (_m, ctx) => setDate(ctx, addDays(ctx.today, 2)) },
  { re: /明天|明日/, apply: (_m, ctx) => setDate(ctx, addDays(ctx.today, 1)) },
  {
    re: /今晚/,
    apply: (_m, ctx) => {
      ctx.evening = true;
      return setDate(ctx, ctx.today) || true;
    },
  },
  { re: /今天|今日/, apply: (_m, ctx) => setDate(ctx, ctx.today) },
  {
    re: new RegExp(`${NUM}\\s*天(?:后|之后|以后)`),
    apply: (m, ctx) => setDate(ctx, addDays(ctx.today, num(m[1]))),
  },
  {
    re: /下(?:个)?(?:周|星期|礼拜)([一二三四五六日天1-7])/,
    apply: (m, ctx) => setDate(ctx, dayInWeek(addDays(startOfWeek(ctx.today), 7), WD[m[1]])),
  },
  {
    re: /(本|这)?(?:周|星期|礼拜)([一二三四五六日天1-7])/,
    apply: (m, ctx) => {
      let d = dayInWeek(startOfWeek(ctx.today), WD[m[2]]);
      if (!m[1] && d < ctx.today) d = addDays(d, 7);
      return setDate(ctx, d);
    },
  },
  {
    re: /(?:本|这个?)?周末/,
    apply: (_m, ctx) => {
      const wd = weekdayOf(ctx.today);
      return setDate(ctx, wd === 0 ? ctx.today : dayInWeek(startOfWeek(ctx.today), 6));
    },
  },
  { re: /下(?:个)?(?:周|星期|礼拜)/, apply: (_m, ctx) => setDate(ctx, addDays(startOfWeek(ctx.today), 7)) },
  {
    re: /月底|月末/,
    apply: (_m, ctx) => {
      const t = parseISODate(ctx.today);
      return setDate(ctx, toISODate(new Date(t.getFullYear(), t.getMonth() + 1, 0)));
    },
  },
  // ---- 时间 ----
  {
    re: /(?<!\d)([01]?\d|2[0-3])[:：]([0-5]\d)(?!\d)/,
    apply: (m, ctx) => setTime(ctx, Number(m[1]), Number(m[2])),
  },
  {
    re: new RegExp(`(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上)?${NUM}点(?:(半)|${NUM}分?)?`),
    apply: (m, ctx) => {
      let h = num(m[2]);
      const min = m[3] ? 30 : m[4] ? num(m[4]) : 0;
      const p = m[1];
      if ((p === '下午' || p === '傍晚' || p === '晚上' || (!p && ctx.evening)) && h < 12) h += 12;
      if (p === '中午' && h < 6) h += 12;
      return setTime(ctx, h, min);
    },
  },
];

function setRepeat(ctx: Ctx, r: Repeat): boolean {
  if (ctx.out.repeat) return false;
  ctx.out.repeat = r;
  return true;
}

/**
 * 解析快速输入。支持：
 *  #标签  @委托人  !1~!4 指定象限  !重要 !紧急
 *  今天/明天/后天/周五/下周一/11月20日/11/20/3天后/月底/周末
 *  15:30、下午3点、晚上8点半
 *  每天/每个工作日/每周一/每月15号
 */
export function parseQuickInput(raw: string, today: string): ParsedInput {
  const ctx: Ctx = { today, out: { title: '', tags: [], tokens: [] } };
  let text = ` ${raw} `;
  for (const rule of RULES) {
    // 标签可以出现多次，其他规则只取第一次
    let guard = 0;
    while (guard++ < (rule.multi ? 20 : 1)) {
      const m = rule.re.exec(text);
      if (!m) break;
      if (!rule.apply(m, ctx)) break;
      text = text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length);
    }
  }
  const out = ctx.out;
  if (!out.quadrant && (ctx.important !== undefined || ctx.urgent !== undefined)) {
    out.quadrant = quadrantOf(!!ctx.important, !!ctx.urgent);
  }
  if (out.repeat && !out.due) out.due = today;
  out.title = text.replace(/\s+/g, ' ').trim();

  if (out.quadrant) out.tokens.push({ kind: 'quadrant', label: `${QMAP[out.quadrant].code} ${QMAP[out.quadrant].verb}` });
  if (out.due) out.tokens.push({ kind: 'date', label: formatDue(out.due, today) });
  if (out.dueTime) out.tokens.push({ kind: 'time', label: out.dueTime });
  if (out.repeat) out.tokens.push({ kind: 'repeat', label: REPEAT_LABEL[out.repeat] });
  if (out.delegate) out.tokens.push({ kind: 'delegate', label: `@${out.delegate}` });
  for (const t of out.tags) out.tokens.push({ kind: 'tag', label: `#${t}` });
  return out;
}
