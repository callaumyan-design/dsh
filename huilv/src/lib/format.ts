export type Decimals = 'auto' | 0 | 2 | 4;

const fmtCache = new Map<string, Intl.NumberFormat>();
function nf(min: number, max: number): Intl.NumberFormat {
  const key = `${min}-${max}`;
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat('en-US', { minimumFractionDigits: min, maximumFractionDigits: max });
    fmtCache.set(key, f);
  }
  return f;
}

/** 小于 1 的数保留 4 位有效数字需要的小数位数 */
function sigDecimals(abs: number, sig = 4): number {
  if (abs === 0) return 2;
  return Math.min(12, Math.max(2, sig - 1 - Math.floor(Math.log10(abs))));
}

/** 换算结果的显示：自动模式下 ≥1 保留两位小数，<1 保留 4 位有效数字 */
export function formatAmount(v: number, decimals: Decimals = 'auto'): string {
  if (!Number.isFinite(v)) return '—';
  if (decimals !== 'auto') return nf(decimals, decimals).format(v);
  const abs = Math.abs(v);
  if (abs === 0) return '0';
  if (abs >= 1) return nf(2, 2).format(v);
  const d = sigDecimals(abs);
  return nf(0, d).format(v);
}

/** 汇率数值：≥1000 两位小数，≥1 四位小数，<1 四位有效数字 */
export function formatRate(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1000) return nf(2, 2).format(v);
  if (abs >= 1) return nf(4, 4).format(v);
  return nf(0, sigDecimals(abs)).format(v);
}

/** 把一个数字串加上千分位，保留用户输入的小数部分（包括末尾的 0 和小数点） */
function groupNumber(s: string): string {
  const [int, frac] = s.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac === undefined ? grouped : `${grouped}.${frac}`;
}

const OP_DISPLAY: Record<string, string> = { '+': '+', '-': '−', '*': '×', '/': '÷' };

/** 算式显示：数字加千分位，运算符换成 + − × ÷ */
export function formatExpr(expr: string): string {
  if (expr === '') return '0';
  let out = '';
  let i = 0;
  if (expr.startsWith('-')) {
    out = '-';
    i = 1;
  }
  const rest = expr.slice(i);
  for (const part of rest.split(/([+\-*/])/)) {
    if (part === '') continue;
    out += part in OP_DISPLAY ? ` ${OP_DISPLAY[part]} ` : groupNumber(part);
  }
  return out.trimEnd();
}

/**
 * “1 USD = 6.6691 CNY” 这一行。数值太小（<0.1）的货币换成 100、1000 等单位，
 * 比如“100 JPY = 4.19 CNY”“10000 VND = 2.59 CNY”。
 * perBase: 1 个目标货币等于多少基准货币
 */
export function unitFor(perBase: number): number {
  if (!(perBase > 0) || perBase >= 0.1) return 1;
  let unit = 10;
  while (unit * perBase < 1 && unit < 100000) unit *= 10;
  return unit;
}

/** 当天相对前一天的涨跌幅（百分比），没有数据时返回 null */
export function changePct(today: number, prev: number | undefined): number | null {
  if (!prev || !Number.isFinite(prev) || !Number.isFinite(today) || prev === 0) return null;
  const pct = (today / prev - 1) * 100;
  return Number.isFinite(pct) ? pct : null;
}

export function formatPct(p: number): string {
  const abs = Math.abs(p);
  const s = abs < 0.005 ? '0.00' : abs.toFixed(2);
  if (s === '0.00') return '0.00%';
  return `${p > 0 ? '+' : '−'}${s}%`;
}

/** “11月20日” */
export function formatDateCN(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${Number(m[2])}月${Number(m[3])}日`;
}

/** “刚刚”“5 分钟前”“3 小时前”“11月18日” */
export function formatAgo(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
