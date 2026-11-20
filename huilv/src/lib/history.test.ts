import { describe, expect, it } from 'vitest';
import {
  cleanCandles,
  crossCandles,
  downsample,
  fetchHistory,
  fromCloses,
  invertCandles,
  isDegenerate,
  movingAverage,
  parseFrankfurter,
  parseYahoo,
  yahooSymbols,
  type Candle,
} from './history';

const D = 86400000;
const k = (day: number, o: number, h: number, l: number, c: number): Candle => ({ t: day * D, o, h, l, c });

function yahooJson(ts: number[], o: number[], h: number[], l: number[], c: (number | null)[]) {
  return { chart: { result: [{ meta: { symbol: 'X' }, timestamp: ts, indicators: { quote: [{ open: o, high: h, low: l, close: c }] } }], error: null } };
}

describe('K 线数据处理', () => {
  it('解析 Yahoo：去掉空值，时间对齐到交易日', () => {
    // 夏令时的外汇日线时间戳是前一天 23:00 UTC
    const day = Date.parse('2026-08-24T00:00:00Z') / 1000;
    const j = yahooJson([day - 3600, day + D / 1000 - 3600, day + (2 * D) / 1000 - 3600], [1, 2, 3], [1.1, 2.2, 3.3], [0.9, 1.8, 2.7], [1.05, null, 3.1]);
    const c = parseYahoo(j)!;
    expect(c).toHaveLength(2);
    expect(new Date(c[0].t).toISOString().slice(0, 10)).toBe('2026-08-24');
    expect(c[1].c).toBe(3.1);
    expect(parseYahoo({ chart: { result: null } })).toBeNull();
  });

  it('清理：高低价覆盖开收盘，同一天去重并排序', () => {
    const c = cleanCandles([k(2, 1, 1, 1, 2), k(1, 1, 0.5, 2, 1), k(2, 1, 1, 1, 3), k(3, NaN, 1, 1, 1)]);
    expect(c.map((x) => x.t / D)).toEqual([1, 2]);
    expect(c[0].h).toBe(1);
    expect(c[0].l).toBe(1);
    expect(c[1].c).toBe(3);
    expect(c[1].h).toBe(3);
  });

  it('反转货币对：高低价互换取倒数', () => {
    const [x] = invertCandles([k(1, 2, 4, 1, 2)]);
    expect(x).toEqual({ t: D, o: 0.5, c: 0.5, h: 1, l: 0.25 });
  });

  it('经美元交叉换算，缺的日期用前一天', () => {
    const a = [k(1, 2, 2, 2, 2), k(2, 3, 3, 3, 3)];
    const b = [k(1, 10, 10, 10, 10)];
    expect(crossCandles(a, b).map((x) => x.c)).toEqual([20, 30]);
  });

  it('只有收盘价时用前一根收盘价作开盘价', () => {
    const flat = [k(1, 5, 5, 5, 5), k(2, 6, 6, 6, 6), k(3, 4, 4, 4, 4)];
    expect(isDegenerate(flat)).toBe(true);
    expect(isDegenerate([k(1, 5, 6, 4, 5), k(2, 5, 7, 4, 6)])).toBe(false);
    const c = fromCloses(flat);
    expect(c[1]).toMatchObject({ o: 5, c: 6, h: 6, l: 5 });
    expect(c[2]).toMatchObject({ o: 6, c: 4, h: 6, l: 4 });
  });

  it('解析欧洲央行数据', () => {
    const c = parseFrankfurter({ rates: { '2026-11-19': { CNY: 6.66 }, '2026-11-18': { CNY: 6.65 } } }, 'CNY')!;
    expect(c.map((x) => x.c)).toEqual([6.65, 6.66]);
  });

  it('Yahoo 代码', () => {
    expect(yahooSymbols('USD', 'CNY')).toEqual(['USDCNY=X']);
    expect(yahooSymbols('BTC', 'CNY')).toEqual(['BTC-CNY']);
    expect(yahooSymbols('XAU', 'USD')).toEqual(['XAUUSD=X', 'GC=F']);
    expect(yahooSymbols('XAU', 'CNY')).toEqual([]);
    expect(yahooSymbols('CNY', 'BTC')).toEqual([]);
  });

  it('均线和抽样', () => {
    const c = [1, 2, 3, 4, 5].map((v, i) => k(i, v, v, v, v));
    expect(movingAverage(c, 3)).toEqual([null, null, 2, 3, 4]);
    const many = Array.from({ length: 100 }, (_, i) => k(i, 1, 1, 1, i));
    const s = downsample(many, 10);
    expect(s).toHaveLength(10);
    expect(s[9].c).toBe(99);
  });
});

describe('获取走势', () => {
  const now = Date.parse('2026-11-20T08:00:00Z');

  it('Worker 里先用 Yahoo，单一价格的日线会转换', async () => {
    const day = Date.parse('2026-11-17T00:00:00Z') / 1000;
    const urls: string[] = [];
    const fetcher = async (url: string) => {
      urls.push(url);
      if (url.includes('USDCNY')) return Response.json(yahooJson([day, day + 86400, day + 172800], [7, 7.1, 7.2], [7, 7.1, 7.2], [7, 7.1, 7.2], [7, 7.1, 7.2]));
      return new Response('', { status: 404 });
    };
    const h = await fetchHistory('USD', 'CNY', '1m', { fetcher, yahoo: true, now });
    expect(h.source).toBe('Yahoo Finance');
    expect(h.ohlc).toBe(false);
    expect(h.candles[1]).toMatchObject({ o: 7, c: 7.1 });
    expect(urls[0]).toContain('query1.finance.yahoo.com/v8/finance/chart/USDCNY%3DX?range=1mo&interval=1d');
  });

  it('Yahoo 不可用时用欧洲央行数据', async () => {
    const fetcher = async (url: string) => {
      if (url.includes('frankfurter')) return Response.json({ rates: { '2026-11-18': { CNY: 6.65 }, '2026-11-19': { CNY: 6.66 } } });
      return new Response('', { status: 429 });
    };
    const h = await fetchHistory('USD', 'CNY', '3m', { fetcher, yahoo: true, now });
    expect(h.source).toBe('欧洲央行参考汇率');
    expect(h.candles).toHaveLength(2);
  });

  it('欧洲央行没有的货币用每日快照抽样', async () => {
    const fetcher = async (url: string) => {
      const m = url.match(/@(\d{4}-\d{2}-\d{2})/);
      if (m) return Response.json({ date: m[1], usd: { twd: 32, vnd: 25000 + Number(m[1].slice(-2)) } });
      throw new TypeError('offline');
    };
    const h = await fetchHistory('TWD', 'VND', '1m', { fetcher, now });
    expect(h.source).toBe('fawazahmed0 每日汇率');
    expect(h.candles.length).toBeGreaterThan(10);
    expect(h.candles.at(-1)!.t).toBeLessThan(now);
  });

  it('先请求同源接口', async () => {
    const data = { from: 'USD', to: 'CNY', range: '1m', interval: '1d', candles: [k(1, 1, 1, 1, 1), k(2, 1, 1, 1, 1)], ohlc: true, source: 'Yahoo Finance', fetchedAt: 1 };
    const h = await fetchHistory('USD', 'CNY', '1m', { fetcher: async () => Response.json(data), apiBase: 'https://x.test/api/history', now });
    expect(h.candles).toHaveLength(2);
    expect(h.fetchedAt).toBeGreaterThan(1);
  });

  it('全部失败时抛错', async () => {
    await expect(fetchHistory('USD', 'CNY', '1m', { fetcher: async () => { throw new TypeError('x'); }, yahoo: true, now })).rejects.toThrow();
  });
});
