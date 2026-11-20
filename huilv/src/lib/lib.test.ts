import { describe, expect, it } from 'vitest';
import { evaluate, hasOperator, press, toPlain, type InputState, type Key } from './calc';
import { changePct, formatAmount, formatExpr, formatPct, formatRate, unitFor } from './format';
import { convert, fetchRates, parseErApi, parseFawaz, perBase, previousDay } from './rates';
import { CURRENCIES, searchCurrencies } from './currencies';
import { FLAGS } from '../data/flags';
import snapshot from '../data/snapshot.json';

function type(keys: Key[], start: InputState = { expr: '', fresh: false }): InputState {
  return keys.reduce(press, start);
}

describe('计算器输入', () => {
  it('输入数字和小数点', () => {
    expect(type(['1', '2', '.', '5']).expr).toBe('12.5');
    expect(type(['.', '5']).expr).toBe('0.5');
    expect(type(['1', '.', '.', '2']).expr).toBe('1.2');
  });

  it('去掉前导零，00 的处理', () => {
    expect(type(['0', '0', '7']).expr).toBe('7');
    expect(type(['00']).expr).toBe('0');
    expect(type(['5', '00']).expr).toBe('500');
  });

  it('切换货币后第一次输入会替换原数字，运算符则接在后面', () => {
    expect(type(['9'], { expr: '14.99', fresh: true }).expr).toBe('9');
    expect(type(['+', '1'], { expr: '14.99', fresh: true }).expr).toBe('14.99+1');
  });

  it('连续输入运算符时替换前一个', () => {
    expect(type(['5', '+', '*', '2']).expr).toBe('5*2');
    expect(type(['5', '.', '+']).expr).toBe('5+');
    expect(type(['+']).expr).toBe('');
  });

  it('退格、清零、等于', () => {
    expect(type(['1', '2', 'back']).expr).toBe('1');
    expect(type(['1', '2', 'clear']).expr).toBe('');
    const r = type(['1', '0', '0', '+', '5', '0', '*', '2', '=']);
    expect(r).toEqual({ expr: '200', fresh: true });
  });

  it('位数有上限', () => {
    const r = type(Array(20).fill('9') as Key[]);
    expect(r.expr.length).toBe(15);
  });
});

describe('算式求值', () => {
  it('先乘除后加减', () => {
    expect(evaluate('1+2*3')).toBe(7);
    expect(evaluate('10-4/2')).toBe(8);
    expect(evaluate('2*3*4-1')).toBe(23);
  });
  it('末尾的运算符和小数点忽略，空串为 0', () => {
    expect(evaluate('12+')).toBe(12);
    expect(evaluate('12.')).toBe(12);
    expect(evaluate('')).toBe(0);
  });
  it('负数开头（上次的结果）', () => {
    expect(evaluate('-5+10')).toBe(5);
    expect(type(['5', '-', '8', '=']).expr).toBe('-3');
  });
  it('除以 0 返回 null', () => {
    expect(evaluate('5/0')).toBeNull();
  });
  it('去掉浮点误差', () => {
    expect(toPlain(0.1 + 0.2)).toBe('0.3');
    expect(toPlain(1e-7)).toBe('0.0000001');
  });
  it('判断是否包含运算符', () => {
    expect(hasOperator('100')).toBe(false);
    expect(hasOperator('-100')).toBe(false);
    expect(hasOperator('100+2')).toBe(true);
  });
});

describe('显示格式', () => {
  it('金额', () => {
    expect(formatAmount(1234567.891)).toBe('1,234,567.89');
    expect(formatAmount(0.004193456)).toBe('0.004193');
    expect(formatAmount(0)).toBe('0');
    expect(formatAmount(12.5, 0)).toBe('13');
    expect(formatAmount(12.5, 4)).toBe('12.5000');
    expect(formatAmount(NaN)).toBe('—');
  });
  it('算式', () => {
    expect(formatExpr('1234.50*3')).toBe('1,234.50 × 3');
    expect(formatExpr('1000-')).toBe('1,000 −');
    expect(formatExpr('-1234')).toBe('-1,234');
    expect(formatExpr('')).toBe('0');
  });
  it('汇率与单位', () => {
    expect(formatRate(6.669069)).toBe('6.6691');
    expect(formatRate(411234.5)).toBe('411,234.50');
    expect(unitFor(6.67)).toBe(1);
    expect(unitFor(0.15)).toBe(1);
    expect(unitFor(0.0419)).toBe(100);
    expect(unitFor(0.00499)).toBe(1000);
    expect(unitFor(0.000259)).toBe(10000);
  });
  it('涨跌幅', () => {
    expect(formatPct(changePct(101, 100)!)).toBe('+1.00%');
    expect(formatPct(changePct(99.5, 100)!)).toBe('−0.50%');
    expect(formatPct(changePct(100.001, 100)!)).toBe('0.00%');
    expect(changePct(1, undefined)).toBeNull();
  });
});

describe('汇率', () => {
  const rates = { USD: 1, CNY: 7, JPY: 150 };
  it('换算', () => {
    expect(convert(100, 'USD', 'CNY', rates)).toBe(700);
    expect(convert(700, 'CNY', 'JPY', rates)).toBeCloseTo(15000);
    expect(convert(1, 'CNY', 'XXX', rates)).toBeNaN();
    expect(perBase('USD', 'CNY', rates)).toBe(7);
  });

  it('解析 fawazahmed0 格式', () => {
    const r = parseFawaz({ date: '2026-11-20', usd: Object.fromEntries(CURRENCIES.map((c) => [c.code.toLowerCase(), 2])) });
    expect(r?.date).toBe('2026-11-20');
    expect(r?.rates.USD).toBe(1);
    expect(r?.rates.CNY).toBe(2);
    expect(parseFawaz({ date: 'x' })).toBeNull();
  });

  it('解析 ExchangeRate-API 格式', () => {
    const r = parseErApi({ result: 'success', base_code: 'USD', time_last_update_unix: 1795132800, rates: Object.fromEntries(CURRENCIES.map((c) => [c.code, 3])) });
    expect(r?.rates.EUR).toBe(3);
    expect(r?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(parseErApi({ result: 'error' })).toBeNull();
  });

  it('前一天', () => {
    expect(previousDay('2026-03-01')).toBe('2026-02-28');
    expect(previousDay('2026-01-01')).toBe('2025-12-31');
  });

  it('依次尝试来源：同源接口失败时用 jsDelivr，并取前一天的数据', async () => {
    const usd = Object.fromEntries(CURRENCIES.map((c) => [c.code.toLowerCase(), 5]));
    const calls: string[] = [];
    const fetcher = async (url: string) => {
      calls.push(url);
      if (url.includes('/api/rates')) return new Response('nope', { status: 404 });
      if (url.includes('@latest')) return Response.json({ date: '2026-11-20', usd });
      if (url.includes('@2026-11-19')) return Response.json({ date: '2026-11-19', usd: { ...usd, cny: 4 } });
      return new Response('', { status: 500 });
    };
    const data = await fetchRates({ fetcher, apiUrl: 'https://x.test/api/rates' });
    expect(data.date).toBe('2026-11-20');
    expect(data.prevDate).toBe('2026-11-19');
    expect(data.prev?.CNY).toBe(4);
    expect(data.fetchedAt).toBeGreaterThan(0);
    expect(calls[0]).toContain('/api/rates');
    expect(calls[1]).toContain('cdn.jsdelivr.net');
  });

  it('fawazahmed0 两个地址都不通时退回到 ExchangeRate-API', async () => {
    const fetcher = async (url: string) => {
      if (url.includes('open.er-api.com'))
        return Response.json({ result: 'success', base_code: 'USD', time_last_update_unix: 1795132800, rates: Object.fromEntries(CURRENCIES.map((c) => [c.code, 3])) });
      throw new TypeError('network');
    };
    const data = await fetchRates({ fetcher });
    expect(data.source).toBe('ExchangeRate-API');
    expect(data.prev).toBeUndefined();
  });

  it('全部失败时抛错', async () => {
    await expect(fetchRates({ fetcher: async () => { throw new TypeError('offline'); } })).rejects.toThrow();
  });
});

describe('数据完整性', () => {
  it('每个币种都有国旗或徽章，内置快照包含每个币种', () => {
    for (const c of CURRENCIES) {
      if (c.flag) expect(FLAGS[c.flag], c.code).toBeTruthy();
      expect(snapshot.rates[c.code as keyof typeof snapshot.rates], c.code).toBeGreaterThan(0);
    }
    expect(new Set(CURRENCIES.map((c) => c.code)).size).toBe(CURRENCIES.length);
  });

  it('搜索：代码、中文、拼音、首字母、英文、地区', () => {
    expect(searchCurrencies('usd')[0].code).toBe('USD');
    expect(searchCurrencies('日元')[0].code).toBe('JPY');
    expect(searchCurrencies('riyuan')[0].code).toBe('JPY');
    expect(searchCurrencies('my')[0].code).toBe('USD');
    expect(searchCurrencies('yen')[0].code).toBe('JPY');
    expect(searchCurrencies('迪拜')[0].code).toBe('AED');
    expect(searchCurrencies('黄金')[0].code).toBe('XAU');
    expect(searchCurrencies('zzzz')).toHaveLength(0);
  });
});
