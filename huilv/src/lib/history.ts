// 汇率走势（K 线）数据。客户端和 Cloudflare Worker 共用。
// 来源顺序：Yahoo Finance（有开高低收，只能在 Worker 里请求）→ 欧洲央行每日参考汇率（Frankfurter）→ fawazahmed0 每日数据（抽样）。
// 后两个只有每日一个价格：用前一天的收盘价作为开盘价构造 K 线（外汇 24 小时交易，当天开盘价约等于前一天收盘价）。
import { SUPPORTED_CODES } from './currencies';

export type Range = '1m' | '3m' | '1y' | '5y';
export type Interval = '1d' | '1wk' | '1mo';

export const RANGES: { id: Range; label: string; kLabel: string; interval: Interval; days: number }[] = [
  { id: '1m', label: '1个月', kLabel: '日K', interval: '1d', days: 31 },
  { id: '3m', label: '3个月', kLabel: '日K', interval: '1d', days: 92 },
  { id: '1y', label: '1年', kLabel: '周K', interval: '1wk', days: 366 },
  { id: '5y', label: '5年', kLabel: '月K', interval: '1mo', days: 1827 },
];

export const rangeInfo = (r: Range) => RANGES.find((x) => x.id === r)!;
export const isRange = (r: unknown): r is Range => RANGES.some((x) => x.id === r);

export interface Candle {
  /** 当天 0 点（UTC）的毫秒时间戳 */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface History {
  from: string;
  to: string;
  range: Range;
  interval: Interval;
  candles: Candle[];
  /** true：数据源给出了真实的开高低收；false：只有收盘价，开盘价取前一根的收盘价 */
  ohlc: boolean;
  source: string;
  fetchedAt: number;
}

export const SOURCE_YAHOO = 'Yahoo Finance';
export const SOURCE_YAHOO_CROSS = 'Yahoo Finance（经美元换算）';
export const SOURCE_ECB = '欧洲央行参考汇率';
export const SOURCE_FAWAZ_DAILY = 'fawazahmed0 每日汇率';

const CRYPTO = new Set(['BTC', 'ETH']);
const METAL_SYMBOLS: Record<string, string[]> = { XAU: ['XAUUSD=X', 'GC=F'], XAG: ['XAGUSD=X', 'SI=F'] };
/** 欧洲央行每天公布参考汇率的货币 */
const ECB = new Set('AUD BRL CAD CHF CNY CZK DKK EUR GBP HKD HUF IDR ILS INR ISK JPY KRW MXN MYR NOK NZD PHP PLN RON SEK SGD THB TRY USD ZAR'.split(' '));

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const dayStart = (ms: number) => Math.floor(ms / 86400000) * 86400000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

async function getJson(fetcher: Fetcher, url: string, timeoutMs: number, headers?: Record<string, string>): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetcher(url, { signal: ctrl.signal, headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** 去掉空值、非正数，按时间排序，同一天只留最后一个，并保证 h ≥ max(o,c)、l ≤ min(o,c) */
export function cleanCandles(list: Candle[]): Candle[] {
  const byDay = new Map<number, Candle>();
  for (const k of list) {
    if (![k.o, k.h, k.l, k.c].every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0)) continue;
    const t = dayStart(k.t);
    byDay.set(t, { t, o: k.o, c: k.c, h: Math.max(k.h, k.o, k.c), l: Math.min(k.l, k.o, k.c) });
  }
  return [...byDay.values()].sort((a, b) => a.t - b.t);
}

/** 只有收盘价时，用前一根的收盘价作为开盘价，高低价至少覆盖开盘和收盘 */
export function fromCloses(list: Candle[]): Candle[] {
  return list.map((k, i) => {
    const o = i > 0 ? list[i - 1].c : k.o;
    return { t: k.t, o, c: k.c, h: Math.max(k.h, o, k.c), l: Math.min(k.l, o, k.c) };
  });
}

/** Yahoo 的外汇日线经常只有一个价格（开高低收相同），超过三成这样就当作只有收盘价 */
export function isDegenerate(list: Candle[]): boolean {
  const flat = list.filter((k) => k.h - k.l <= Math.abs(k.c) * 1e-7).length;
  return flat > list.length * 0.3;
}

export function invertCandles(list: Candle[]): Candle[] {
  return list.map((k) => ({ t: k.t, o: 1 / k.o, c: 1 / k.c, h: 1 / k.l, l: 1 / k.h }));
}

/** a 是 X/USD，b 是 USD/Y，按日期对齐后得到 X/Y（高低价是近似值） */
export function crossCandles(a: Candle[], b: Candle[]): Candle[] {
  const mb = new Map(b.map((k) => [k.t, k]));
  const out: Candle[] = [];
  let lastB: Candle | undefined;
  const bs = [...b];
  let j = 0;
  for (const k of a) {
    // 用当天或之前最近一天的 b
    while (j < bs.length && bs[j].t <= k.t) lastB = bs[j++];
    const kb = mb.get(k.t) ?? lastB;
    if (!kb) continue;
    out.push({ t: k.t, o: k.o * kb.o, c: k.c * kb.c, h: k.h * kb.h, l: k.l * kb.l });
  }
  return cleanCandles(out);
}

/** 解析 Yahoo Finance v8 chart 接口 */
export function parseYahoo(json: unknown): Candle[] | null {
  const r = (json as { chart?: { result?: unknown[] } })?.chart?.result?.[0] as
    | { timestamp?: number[]; indicators?: { quote?: { open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[] }[] } }
    | undefined;
  const ts = r?.timestamp;
  const q = r?.indicators?.quote?.[0];
  if (!ts || !q?.close) return null;
  // 外汇日线的时间戳是伦敦时间 0 点（夏令时为前一天 23:00 UTC），加 6 小时再取整到日期
  const list: Candle[] = ts.map((t, i) => ({
    t: t * 1000 + 6 * 3600000,
    o: q.open?.[i] ?? NaN,
    h: q.high?.[i] ?? NaN,
    l: q.low?.[i] ?? NaN,
    c: q.close?.[i] ?? NaN,
  }));
  const clean = cleanCandles(list);
  return clean.length >= 2 ? clean : null;
}

/** 某个货币对在 Yahoo 上可以直接查询的代码（按优先级） */
export function yahooSymbols(from: string, to: string): string[] {
  if (from === to) return [];
  if (CRYPTO.has(from) && !CRYPTO.has(to)) return [`${from}-${to}`];
  if (METAL_SYMBOLS[from] && to === 'USD') return METAL_SYMBOLS[from];
  if (CRYPTO.has(from) || CRYPTO.has(to) || METAL_SYMBOLS[from] || METAL_SYMBOLS[to]) return [];
  return [`${from}${to}=X`];
}

const YAHOO_HEADERS = { 'user-agent': 'Mozilla/5.0 (compatible; huilv/1.0)', accept: 'application/json' };

async function yahooSeries(fetcher: Fetcher, symbol: string, range: Range, timeoutMs: number): Promise<Candle[] | null> {
  const info = rangeInfo(range);
  const yr = { '1m': '1mo', '3m': '3mo', '1y': '1y', '5y': '5y' }[range];
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?range=${yr}&interval=${info.interval}`;
  for (const host of ['query1', 'query2']) {
    try {
      return parseYahoo(await getJson(fetcher, `https://${host}.finance.yahoo.com${path}`, timeoutMs, YAHOO_HEADERS));
    } catch (e) {
      // 代码不存在（404）时不必再试另一个地址
      if (e instanceof Error && e.message === 'HTTP 404') return null;
    }
  }
  return null;
}

/** 直接查询，或者查询反向货币对再取倒数 */
async function yahooPair(fetcher: Fetcher, from: string, to: string, range: Range, timeoutMs: number): Promise<Candle[] | null> {
  for (const s of yahooSymbols(from, to)) {
    const c = await yahooSeries(fetcher, s, range, timeoutMs);
    if (c) return c;
  }
  for (const s of yahooSymbols(to, from)) {
    const c = await yahooSeries(fetcher, s, range, timeoutMs);
    if (c) return invertCandles(c);
  }
  return null;
}

export async function fetchYahoo(fetcher: Fetcher, from: string, to: string, range: Range, timeoutMs = 7000): Promise<{ candles: Candle[]; source: string; ohlc: boolean } | null> {
  const done = (candles: Candle[], source: string) => {
    const flat = isDegenerate(candles);
    return { candles: flat ? fromCloses(candles) : candles, source, ohlc: !flat };
  };
  const direct = await yahooPair(fetcher, from, to, range, timeoutMs);
  if (direct) return done(direct, SOURCE_YAHOO);
  if (from === 'USD' || to === 'USD') return null;
  const [a, b] = await Promise.all([yahooPair(fetcher, from, 'USD', range, timeoutMs), yahooPair(fetcher, 'USD', to, range, timeoutMs)]);
  if (!a || !b) return null;
  const c = crossCandles(a, b);
  return c.length >= 2 ? done(c, SOURCE_YAHOO_CROSS) : null;
}

const closeCandle = (t: number, v: number): Candle => ({ t, o: v, h: v, l: v, c: v });

/** Frankfurter（欧洲央行）：{ rates: { "2026-11-19": { CNY: 6.67 } } } */
export function parseFrankfurter(json: unknown, to: string): Candle[] | null {
  const rates = (json as { rates?: Record<string, Record<string, number>> })?.rates;
  if (!rates || typeof rates !== 'object') return null;
  const list = Object.entries(rates)
    .map(([d, r]) => closeCandle(Date.parse(`${d}T00:00:00Z`), r?.[to]))
    .filter((k) => Number.isFinite(k.t));
  const clean = cleanCandles(list);
  return clean.length >= 2 ? clean : null;
}

export async function fetchEcb(fetcher: Fetcher, from: string, to: string, range: Range, now: number, timeoutMs = 7000): Promise<Candle[] | null> {
  if (!ECB.has(from) || !ECB.has(to) || from === to) return null;
  const start = iso(now - rangeInfo(range).days * 86400000);
  const url = `https://api.frankfurter.dev/v1/${start}..?base=${from}&symbols=${to}`;
  try {
    const c = parseFrankfurter(await getJson(fetcher, url, timeoutMs), to);
    return c ? downsample(c, 140) : null;
  } catch {
    return null;
  }
}

/** fawazahmed0 每天一份数据，按间隔抽样最多 n 天 */
export async function fetchFawazSeries(fetcher: Fetcher, from: string, to: string, range: Range, now: number, n = 24, timeoutMs = 6000): Promise<Candle[] | null> {
  const days = rangeInfo(range).days;
  const step = Math.max(1, Math.round(days / n));
  // 这个数据源从 2024-03-02 开始
  const earliest = Date.parse('2024-03-02T00:00:00Z');
  const dates: number[] = [];
  for (let d = dayStart(now) - 86400000; d >= dayStart(now) - days * 86400000 && d >= earliest; d -= step * 86400000) dates.push(d);
  const lf = from.toLowerCase();
  const lt = to.toLowerCase();
  const results = await Promise.all(
    dates.map(async (t) => {
      const tag = iso(t);
      for (const url of [
        `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${tag}/v1/currencies/usd.min.json`,
        `https://${tag}.currency-api.pages.dev/v1/currencies/usd.min.json`,
      ]) {
        try {
          const j = (await getJson(fetcher, url, timeoutMs)) as { usd?: Record<string, number> };
          const a = lf === 'usd' ? 1 : j.usd?.[lf];
          const b = lt === 'usd' ? 1 : j.usd?.[lt];
          if (a && b) return closeCandle(t, b / a);
        } catch {
          /* 换下一个地址 */
        }
      }
      return null;
    }),
  );
  const clean = cleanCandles(results.filter((x): x is Candle => !!x));
  return clean.length >= 2 ? clean : null;
}

/** 点太多时等间隔抽样，保留最后一个点 */
export function downsample(list: Candle[], max: number): Candle[] {
  if (list.length <= max) return list;
  const step = list.length / max;
  const out: Candle[] = [];
  for (let i = 0; i < max - 1; i++) out.push(list[Math.floor(i * step)]);
  out.push(list[list.length - 1]);
  return out;
}

export interface HistoryOptions {
  fetcher?: Fetcher;
  /** 先请求同源的 /api/history（Cloudflare Worker） */
  apiBase?: string | null;
  /** 只有 Worker 里才请求 Yahoo（浏览器里会被跨域限制挡住） */
  yahoo?: boolean;
  now?: number;
}

export function isPair(from: unknown, to: unknown): boolean {
  return typeof from === 'string' && typeof to === 'string' && from !== to && SUPPORTED_CODES.includes(from) && SUPPORTED_CODES.includes(to);
}

function isHistory(x: unknown): x is History {
  const h = x as History;
  return !!h && Array.isArray(h.candles) && h.candles.length >= 2 && typeof h.ohlc === 'boolean' && typeof h.source === 'string';
}

export async function fetchHistory(from: string, to: string, range: Range, opts: HistoryOptions = {}): Promise<History> {
  const fetcher: Fetcher = opts.fetcher ?? ((u, i) => fetch(u, i));
  const now = opts.now ?? Date.now();
  const interval = rangeInfo(range).interval;
  const base = { from, to, range, interval, fetchedAt: Date.now() };

  if (opts.apiBase) {
    try {
      const url = `${opts.apiBase}?from=${from}&to=${to}&range=${range}`;
      const j = await getJson(fetcher, url, 15000);
      if (isHistory(j)) return { ...j, fetchedAt: Date.now() };
    } catch {
      /* 没有 Worker，直接请求公开接口 */
    }
  }

  if (opts.yahoo) {
    const y = await fetchYahoo(fetcher, from, to, range);
    if (y) return { ...base, candles: y.candles, ohlc: y.ohlc, source: y.source };
  }

  const ecb = await fetchEcb(fetcher, from, to, range, now);
  if (ecb) return { ...base, interval: '1d', candles: fromCloses(ecb), ohlc: false, source: SOURCE_ECB };

  const fz = await fetchFawazSeries(fetcher, from, to, range, now);
  if (fz) return { ...base, interval: '1d', candles: fromCloses(fz), ohlc: false, source: SOURCE_FAWAZ_DAILY };

  throw new Error('暂时无法获取走势数据');
}

/** 简单移动平均，前 n-1 个为 null */
export function movingAverage(candles: Candle[], n: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].c;
    if (i >= n) sum -= candles[i - n].c;
    out.push(i >= n - 1 ? sum / n : null);
  }
  return out;
}
