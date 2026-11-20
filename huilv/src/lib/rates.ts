// 汇率数据：统一成“1 美元等于多少单位”的表。客户端和 Cloudflare Worker 共用这里的解析逻辑。
import { SUPPORTED_CODES } from './currencies';

export interface RateData {
  /** 汇率对应的日期 YYYY-MM-DD */
  date: string;
  /** 1 USD = rates[code] 单位 */
  rates: Record<string, number>;
  /** 前一天的汇率，用于显示涨跌 */
  prev?: Record<string, number>;
  prevDate?: string;
  /** 数据来源的简短说明 */
  source: string;
  /** 本机拿到这份数据的时间（毫秒）；0 表示应用内置的数据 */
  fetchedAt: number;
}

export const SOURCE_FAWAZ = 'fawazahmed0/exchange-api';
export const SOURCE_ERAPI = 'ExchangeRate-API';

const fawazJsdelivr = (tag: string) =>
  `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${tag}/v1/currencies/usd.min.json`;
const fawazPages = (tag: string) => `https://${tag}.currency-api.pages.dev/v1/currencies/usd.min.json`;
export const ERAPI_URL = 'https://open.er-api.com/v6/latest/USD';

/** 只保留应用支持的币种，代码转成大写 */
function pick(src: Record<string, unknown>, lower: boolean): Record<string, number> {
  const out: Record<string, number> = {};
  for (const code of SUPPORTED_CODES) {
    const v = src[lower ? code.toLowerCase() : code];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[code] = v;
  }
  out.USD = 1;
  return out;
}

/** fawazahmed0/exchange-api：{ date, usd: { cny: 6.67, ... } } */
export function parseFawaz(json: unknown): { date: string; rates: Record<string, number> } | null {
  if (!json || typeof json !== 'object') return null;
  const j = json as { date?: unknown; usd?: unknown };
  if (typeof j.date !== 'string' || !j.usd || typeof j.usd !== 'object') return null;
  const rates = pick(j.usd as Record<string, unknown>, true);
  if (Object.keys(rates).length < 10) return null;
  return { date: j.date, rates };
}

/** open.er-api.com：{ result: "success", base_code: "USD", time_last_update_unix, rates: { CNY: 6.67 } } */
export function parseErApi(json: unknown): { date: string; rates: Record<string, number> } | null {
  if (!json || typeof json !== 'object') return null;
  const j = json as { result?: unknown; base_code?: unknown; time_last_update_unix?: unknown; rates?: unknown };
  if (j.result !== 'success' || j.base_code !== 'USD' || !j.rates || typeof j.rates !== 'object') return null;
  const rates = pick(j.rates as Record<string, unknown>, false);
  if (Object.keys(rates).length < 10) return null;
  const ts = typeof j.time_last_update_unix === 'number' ? j.time_last_update_unix * 1000 : Date.now();
  return { date: new Date(ts).toISOString().slice(0, 10), rates };
}

/** 检查一份 RateData 是否可用（来自缓存或 /api/rates） */
export function isRateData(x: unknown): x is RateData {
  if (!x || typeof x !== 'object') return false;
  const r = x as RateData;
  return (
    typeof r.date === 'string' &&
    !!r.rates &&
    typeof r.rates === 'object' &&
    typeof r.rates.USD === 'number' &&
    Object.keys(r.rates).length >= 10 &&
    typeof r.source === 'string'
  );
}

export function previousDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

async function getJson(fetcher: Fetcher, url: string, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetcher(url, { signal: ctrl.signal, cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function firstOk<T>(tasks: (() => Promise<T | null>)[]): Promise<T | null> {
  for (const t of tasks) {
    try {
      const v = await t();
      if (v) return v;
    } catch {
      /* 换下一个来源 */
    }
  }
  return null;
}

export interface FetchOptions {
  fetcher?: Fetcher;
  timeoutMs?: number;
  /** 先在同源 /api/rates 上试（Cloudflare 部署时由 Worker 提供） */
  apiUrl?: string | null;
  /** jsDelivr 在中国大陆更快，Worker 里则优先用 pages.dev */
  preferPages?: boolean;
}

/** 依次尝试各个来源，全部失败时抛出错误 */
export async function fetchRates(opts: FetchOptions = {}): Promise<RateData> {
  const fetcher: Fetcher = opts.fetcher ?? ((u, i) => fetch(u, i));
  const timeout = opts.timeoutMs ?? 8000;

  if (opts.apiUrl) {
    try {
      const j = await getJson(fetcher, opts.apiUrl, timeout);
      if (isRateData(j)) return { ...j, fetchedAt: Date.now() };
    } catch {
      /* 没有部署 Worker（比如 GitHub Pages 或本地文件），直接请求公开接口 */
    }
  }

  const fawazUrls = (tag: string) => (opts.preferPages ? [fawazPages(tag), fawazJsdelivr(tag)] : [fawazJsdelivr(tag), fawazPages(tag)]);

  const latest = await firstOk(fawazUrls('latest').map((u) => async () => parseFawaz(await getJson(fetcher, u, timeout))));
  if (latest) {
    const prevDate = previousDay(latest.date);
    const prev = await firstOk(fawazUrls(prevDate).map((u) => async () => parseFawaz(await getJson(fetcher, u, timeout))));
    return {
      date: latest.date,
      rates: latest.rates,
      ...(prev && prev.date === prevDate ? { prev: prev.rates, prevDate } : {}),
      source: SOURCE_FAWAZ,
      fetchedAt: Date.now(),
    };
  }

  const er = await firstOk([async () => parseErApi(await getJson(fetcher, ERAPI_URL, timeout))]);
  if (er) return { date: er.date, rates: er.rates, source: SOURCE_ERAPI, fetchedAt: Date.now() };

  throw new Error('所有汇率来源都无法访问');
}

/** amount 个 from 货币等于多少 to 货币；缺少汇率时返回 NaN */
export function convert(amount: number, from: string, to: string, rates: Record<string, number>): number {
  const a = rates[from];
  const b = rates[to];
  if (!a || !b) return NaN;
  if (from === to) return amount;
  return (amount / a) * b;
}

/** 1 个 code 货币等于多少 base 货币 */
export function perBase(code: string, base: string, rates: Record<string, number>): number {
  return convert(1, code, base, rates);
}
