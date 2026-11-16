// 行情卡片的检查：代码校验、交易时间、各数据源的解析、/api/quotes 接口。
// 腾讯、新浪等的返回内容是按它们公开流传的格式自己造的样例（这里连不上真实接口），
// 部署后要用 /api/quotes/selftest 对照真实返回再核对一遍。
// 运行方法：在仓库根目录执行  node --test
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeId, inferAShare, candidatesFor, groupOf, isIndex, fxName, DEFAULT_WATCHLIST, MAX_IDS } from "../assets/js/market/ids.js";
import { marketStatus, zonedToEpoch } from "../assets/js/market/hours.js";
import {
  checkNumbers,
  parseTencent,
  parseSina,
  parseFinnhub,
  parseTwelveData,
  parseFrankfurter,
  fetchText,
  tencentCode,
  sinaCode,
  chainFor,
  FormatError,
} from "../tools/worker/quote-sources.js";
import { handleQuotes, ttlFor } from "../tools/worker/quotes.js";

// ---------- 造 GBK 编码的样例（Node 只能解码 GBK，不能编码，所以反查一张表） ----------
const gbkTable = new Map();
{
  const dec = new TextDecoder("gbk", { fatal: true });
  for (let a = 0x81; a <= 0xfe; a++) {
    for (let b = 0x40; b <= 0xfe; b++) {
      if (b === 0x7f) continue;
      try {
        const ch = dec.decode(new Uint8Array([a, b]));
        if (ch.length === 1 && !gbkTable.has(ch)) gbkTable.set(ch, [a, b]);
      } catch {
        /* 不是有效字符 */
      }
    }
  }
}
function gbk(text) {
  const out = [];
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 0x80) out.push(code);
    else if (gbkTable.has(ch)) out.push(...gbkTable.get(ch));
    else throw new Error("样例里有 GBK 编不了的字：" + ch);
  }
  return new Uint8Array(out);
}

/** 造一行腾讯格式的数据：fields 是 { 下标: 值 } */
function tencentLine(code, fields, length = 50) {
  const f = Array.from({ length }, () => "0");
  for (const [i, v] of Object.entries(fields)) f[i] = v;
  return `v_${code}="${f.join("~")}";`;
}
function sinaLine(code, fields, length) {
  const f = Array.from({ length }, () => "0");
  for (const [i, v] of Object.entries(fields)) f[i] = v;
  return `var hq_str_${code}="${f.join(",")}";`;
}

const T = {
  maotai: tencentLine("sh600519", { 0: "1", 1: "贵州茅台", 2: "600519", 3: "1459.00", 4: "1449.00", 30: "20261116150003", 31: "10.00", 32: "0.69" }),
  index: tencentLine("sh000001", { 0: "1", 1: "上证指数", 2: "000001", 3: "3366.12", 4: "3350.00", 30: "20261116150002", 31: "16.12", 32: "0.48" }),
  tencentHk: tencentLine("hk00700", { 0: "100", 1: "腾讯控股", 2: "00700", 3: "380.200", 4: "378.000", 30: "2026/11/16 16:08:46", 31: "2.200", 32: "0.58" }),
  hsi: tencentLine("hkHSI", { 0: "100", 1: "恒生指数", 2: "HSI", 3: "17500.50", 4: "17600.00", 30: "2026/11/16 16:09:01", 31: "-99.50", 32: "-0.57" }),
  apple: tencentLine("usAAPL", { 0: "200", 1: "苹果", 2: "AAPL.OQ", 3: "191.56", 4: "188.63", 30: "2026-11-13 16:00:01", 31: "2.93", 32: "1.55" }),
  ixic: tencentLine("us.IXIC", { 0: "200", 1: "纳斯达克综合指数", 2: ".IXIC", 3: "15000.10", 4: "14900.10", 30: "2026-11-13 16:15:00", 31: "100.00", 32: "0.67" }),
};

// ---------- 代码 ----------
test("代码：各种写法整理成统一格式，不合法的一律不认", () => {
  assert.equal(normalizeId("sh:600519"), "SH:600519");
  assert.equal(normalizeId(" hk:700 "), "HK:00700");
  assert.equal(normalizeId("HK:hsi"), "HK:HSI");
  assert.equal(normalizeId("us:nvda"), "US:NVDA");
  assert.equal(normalizeId("US:^IXIC"), "US:.IXIC");
  assert.equal(normalizeId("US:BRK.B"), "US:BRK.B");
  assert.equal(normalizeId("fx:aud/cny"), "FX:AUDCNY");
  assert.equal(normalizeId("FX:USDCNH"), "FX:USDCNH");
  for (const bad of ["", "600519", "SH:60051", "SH:6005190", "XX:600519", "HK:123456", "US:TOOLONGX", "US:A/B", "US:../X", "FX:CNYCNY", "FX:ABCDEF", "SH:600519,SZ:000001", "SH:600519&x=1", "HK:00700?", "US:<b>", null, 42, "SH:" + "1".repeat(30)]) {
    assert.equal(normalizeId(bad), "", String(bad));
  }
});

test("代码：A 股按开头推断交易所；000 开头的指数和个股撞号时两个都给", () => {
  assert.deepEqual(inferAShare("600519"), ["SH:600519"]);
  assert.deepEqual(inferAShare("688981"), ["SH:688981"]);
  assert.deepEqual(inferAShare("510300"), ["SH:510300"]);
  assert.deepEqual(inferAShare("002594"), ["SZ:002594"]);
  assert.deepEqual(inferAShare("300750"), ["SZ:300750"]);
  assert.deepEqual(inferAShare("399006"), ["SZ:399006"]);
  assert.deepEqual(inferAShare("159915"), ["SZ:159915"]);
  assert.deepEqual(inferAShare("920118"), ["BJ:920118"]); // 北交所 2025-10-09 起都是 920 开头
  assert.deepEqual(inferAShare("899050"), ["BJ:899050"]); // 北证50
  assert.deepEqual(inferAShare("000001"), ["SZ:000001", "SH:000001"]); // 平安银行 / 上证指数
  assert.deepEqual(inferAShare("000300"), ["SZ:000300", "SH:000300"]);
  assert.deepEqual(inferAShare("12345"), []);
  assert.deepEqual(candidatesFor("A", "sh000001"), ["SH:000001"]);
  assert.deepEqual(candidatesFor("A", "600519"), ["SH:600519"]);
  assert.deepEqual(candidatesFor("HK", "700"), ["HK:00700"]);
  assert.deepEqual(candidatesFor("US", "nvda"), ["US:NVDA"]);
  assert.deepEqual(candidatesFor("FX", "usd/cnh"), ["FX:USDCNH"]);
  assert.deepEqual(candidatesFor("US", "HK:00700"), []); // 选了美股却填了港股代码
  assert.equal(groupOf("BJ:920118"), "A");
  assert.equal(isIndex("SH:000001"), true);
  assert.equal(isIndex("SZ:000001"), false);
  assert.equal(isIndex("US:.DJI"), true);
  assert.equal(fxName("FX:USDCNH"), "美元/人民币（离岸）");
  assert.equal(fxName("FX:AUDCNY"), "澳元/人民币（在岸）");
  assert.ok(DEFAULT_WATCHLIST.every((x) => normalizeId(x.id) === x.id));
  assert.equal(MAX_IDS, 40);
});

// ---------- 交易时间 ----------
const at = (iso) => Date.parse(iso);

test("交易时间：A 股、港股的各个时段（按交易所时区）", () => {
  // 2026-11-16 是星期一。北京时间 = UTC+8
  assert.equal(marketStatus("A", at("2026-11-16T01:20:00Z")), "pre"); // 9:20 集合竞价
  assert.equal(marketStatus("A", at("2026-11-16T00:00:00Z")), "closed"); // 8:00 还没到竞价时间
  assert.equal(marketStatus("HK", at("2026-11-16T01:10:00Z")), "pre"); // 9:10 开市前时段
  assert.equal(marketStatus("HK", at("2026-11-15T23:30:00Z")), "closed"); // UTC 周日 23:30 = 香港周一 7:30，还没开市
  assert.equal(marketStatus("A", at("2026-11-16T02:00:00Z")), "open"); // 10:00
  assert.equal(marketStatus("A", at("2026-11-16T03:45:00Z")), "lunch"); // 11:45
  assert.equal(marketStatus("A", at("2026-11-16T06:00:00Z")), "open"); // 14:00
  assert.equal(marketStatus("A", at("2026-11-16T07:30:00Z")), "closed"); // 15:30
  assert.equal(marketStatus("A", at("2026-11-15T02:00:00Z")), "holiday"); // 星期天
  assert.equal(marketStatus("HK", at("2026-11-16T04:30:00Z")), "lunch"); // 12:30
  assert.equal(marketStatus("HK", at("2026-11-16T08:05:00Z")), "open"); // 16:05 收市竞价
  assert.equal(marketStatus("HK", at("2026-11-16T08:15:00Z")), "closed"); // 16:15
});

test("交易时间：美股夏令时切换前后（2026-03-08 开始，2026-11-01 结束）", () => {
  // 同样是 UTC 14:00：切换前是纽约 9:00（盘前），切换后是纽约 10:00（交易中）
  assert.equal(marketStatus("US", at("2026-03-06T14:00:00Z")), "pre");
  assert.equal(marketStatus("US", at("2026-03-09T14:00:00Z")), "open");
  // 秋天切回冬令时：UTC 13:45 在 10 月 30 日是纽约 9:45（交易中），11 月 2 日是 8:45（盘前）
  assert.equal(marketStatus("US", at("2026-10-30T13:45:00Z")), "open");
  assert.equal(marketStatus("US", at("2026-11-02T13:45:00Z")), "pre");
  assert.equal(marketStatus("US", at("2026-11-16T22:00:00Z")), "post"); // 17:00
  assert.equal(marketStatus("US", at("2026-11-17T02:00:00Z")), "closed"); // 21:00
  // 换算当地时间：夏令时开始当天的凌晨 3:30
  assert.equal(new Date(zonedToEpoch("America/New_York", "2026-03-08 03:30:00")).toISOString(), "2026-03-08T07:30:00.000Z");
  assert.equal(new Date(zonedToEpoch("America/New_York", "2026-11-16 09:30:00")).toISOString(), "2026-11-16T14:30:00.000Z");
});

test("交易时间：节假日不写死，交易时段里最新成交不是今天就算休市；外汇按纽约时间周日 17 点到周五 17 点", () => {
  const now = at("2026-11-16T02:30:00Z"); // 北京时间周一 10:30
  assert.equal(marketStatus("A", now, at("2026-11-16T02:29:00Z")), "open");
  assert.equal(marketStatus("A", now, at("2026-11-13T07:00:00Z")), "holiday"); // 最新成交还是上周五
  // 刚开盘 10 分钟内不急着判断（港股免费行情可能延时 15 分钟）
  assert.equal(marketStatus("HK", at("2026-11-16T01:40:00Z"), at("2026-11-13T08:08:00Z")), "open");
  assert.equal(marketStatus("HK", at("2026-11-16T02:30:00Z"), at("2026-11-13T08:08:00Z")), "holiday");
  // 盘前看到昨天的成交是正常的
  assert.equal(marketStatus("A", at("2026-11-16T01:20:00Z"), at("2026-11-13T07:00:00Z")), "pre");
  assert.equal(marketStatus("FX", at("2026-11-14T12:00:00Z")), "holiday"); // 星期六
  assert.equal(marketStatus("FX", at("2026-11-15T21:30:00Z")), "holiday"); // 纽约周日 16:30（冬令时 UTC-5），还没开
  assert.equal(marketStatus("FX", at("2026-11-15T23:00:00Z")), "open"); // 纽约周日 18:00
  assert.equal(marketStatus("FX", at("2026-11-20T23:00:00Z")), "holiday"); // 纽约周五 18:00
});

// ---------- 核对数字 ----------
test("核对数字：涨跌额、涨跌幅必须和现价、昨收对得上", () => {
  assert.deepEqual(checkNumbers({ price: "1459.00", prev: "1449.00", change: "10.00", changePct: "0.69" }), { price: 1459, prev: 1449, change: 10, changePct: 0.6901 });
  assert.throws(() => checkNumbers({ price: "1459", prev: "1449", change: "1449" }), FormatError); // 字段错位
  assert.throws(() => checkNumbers({ price: "1459", prev: "1449", change: "10", changePct: "6.9" }), FormatError);
  assert.throws(() => checkNumbers({ price: "0", prev: "1449" }), FormatError);
  assert.throws(() => checkNumbers({ price: "abc", prev: "1449" }), FormatError);
});

// ---------- 腾讯 ----------
test("腾讯：A 股、指数、港股、美股、美股指数", () => {
  const ids = ["SH:600519", "SH:000001", "HK:00700", "HK:HSI", "US:AAPL", "US:.IXIC"];
  const { quotes, errors } = parseTencent(Object.values(T).join("\n"), ids);
  assert.equal(errors.size, 0, JSON.stringify([...errors]));
  const m = quotes.get("SH:600519");
  assert.equal(m.name, "贵州茅台");
  assert.equal(m.price, 1459);
  assert.equal(m.change, 10);
  assert.equal(m.currency, "CNY");
  assert.equal(m.delayed, false);
  assert.equal(new Date(m.time).toISOString(), "2026-11-16T07:00:03.000Z"); // 北京时间 15:00:03
  assert.equal(quotes.get("SH:000001").currency, ""); // 指数没有币种
  assert.equal(quotes.get("HK:00700").currency, "HKD");
  assert.equal(quotes.get("HK:00700").delayed, true);
  assert.equal(new Date(quotes.get("HK:00700").time).toISOString(), "2026-11-16T08:08:46.000Z");
  assert.equal(quotes.get("HK:HSI").change, -99.5);
  assert.equal(quotes.get("US:AAPL").name, "苹果");
  assert.equal(new Date(quotes.get("US:AAPL").time).toISOString(), "2026-11-13T21:00:01.000Z"); // 纽约 16:00:01（冬令时）
  assert.equal(quotes.get("US:.IXIC").name, "纳斯达克综合指数");
  assert.equal(tencentCode("BJ:920118"), "bj920118");
  assert.equal(tencentCode("US:.DJI"), "us.DJI");
});

test("腾讯：查不到、代码对不上、字段错位都报错，不给出数字", () => {
  const text = [
    'v_pv_none_match="1";',
    tencentLine("sz000001", { 1: "平安银行", 2: "600519", 3: "12", 4: "11.9", 30: "20261116150003", 31: "0.1", 32: "0.84" }), // 代码对不上
    tencentLine("sz000002", { 1: "万科A", 2: "000002", 3: "11.9", 4: "12", 30: "20261116150003", 31: "11.9", 32: "0.84" }), // 涨跌额错位
    tencentLine("sz000003", { 1: "某股", 2: "000003", 3: "10", 4: "9" }, 20), // 字段太少
    tencentLine("sz000004", { 1: "某股", 2: "000004", 3: "10", 4: "9", 30: "昨天", 31: "1", 32: "11.11" }), // 时间看不懂
  ].join("\n");
  const { quotes, errors } = parseTencent(text, ["SH:688001", "SZ:000001", "SZ:000002", "SZ:000003", "SZ:000004"]);
  assert.equal(quotes.size, 0);
  assert.equal(errors.get("SH:688001"), "查不到这个代码");
  assert.match(errors.get("SZ:000001"), /代码对不上/);
  assert.match(errors.get("SZ:000002"), /涨跌额对不上/);
  assert.match(errors.get("SZ:000003"), /字段太少/);
  assert.match(errors.get("SZ:000004"), /时间看不懂/);
});

test("取数据：GBK 编码的返回能正确解出中文", async () => {
  const bytes = gbk(T.maotai);
  const fetcher = async () => new Response(bytes, { status: 200 });
  const res = await fetchText(fetcher, "https://qt.gtimg.cn/q=sh600519", { gbk: true });
  const { quotes } = parseTencent(res.text, ["SH:600519"]);
  assert.equal(quotes.get("SH:600519").name, "贵州茅台");
});

test("取数据：超过 5 秒没回应就放弃", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const fetcher = (url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
  const pending = fetchText(fetcher, "https://qt.gtimg.cn/q=x");
  t.mock.timers.tick(5000);
  await assert.rejects(pending, /5 秒/);
});

// ---------- 新浪 ----------
const S = {
  a: sinaLine("sh600519", { 0: "贵州茅台", 1: "1450.00", 2: "1449.00", 3: "1459.00", 4: "1460", 5: "1440", 30: "2026-11-16", 31: "15:00:03", 32: "00" }, 33),
  hk: sinaLine("rt_hk00700", { 0: "TENCENT", 1: "腾讯控股", 2: "379", 3: "378.000", 4: "381", 5: "377", 6: "380.200", 7: "2.200", 8: "0.582", 17: "2026/11/16", 18: "16:08" }, 25),
  us: sinaLine(
    "gb_aapl",
    { 0: "苹果", 1: "191.5600", 2: "1.55", 3: "2026-11-14 05:00:01", 4: "2.9300", 21: "192.1000", 22: "0.28", 23: "0.5400", 24: "Nov 13 07:59PM EST", 26: "188.6300" },
    30
  ),
  usBadExt: sinaLine("gb_msft", { 0: "微软", 1: "400.00", 2: "1.01", 3: "2026-11-14 05:00:01", 4: "4.00", 21: "999", 22: "0.28", 23: "0.54", 24: "Nov 13 07:59PM EST" }, 30),
  fx: sinaLine("fx_susdcnh", { 0: "15:59:58", 1: "7.2830", 2: "7.2850", 3: "7.2800", 5: "7.2790", 6: "7.2900", 7: "7.2700", 8: "7.2840", 9: "美元兑离岸人民币", 17: "2026-11-16" }, 18),
  fxBad: sinaLine("fx_saudcny", { 0: "15:59:58", 1: "4.6", 2: "4.7", 3: "4.65", 8: "0.0001", 9: "澳元兑人民币" }, 18),
};

test("新浪：A 股、港股、美股（含核对过的盘后价）、离岸人民币", () => {
  const ids = ["SH:600519", "HK:00700", "US:AAPL", "FX:USDCNH"];
  const { quotes, errors } = parseSina([S.a, S.hk, S.us, S.fx].join("\n"), ids);
  assert.equal(errors.size, 0, JSON.stringify([...errors]));
  assert.equal(quotes.get("SH:600519").change, 10);
  assert.equal(new Date(quotes.get("SH:600519").time).toISOString(), "2026-11-16T07:00:03.000Z");
  assert.equal(quotes.get("HK:00700").name, "腾讯控股");
  assert.equal(new Date(quotes.get("HK:00700").time).toISOString(), "2026-11-16T08:08:00.000Z");
  const us = quotes.get("US:AAPL");
  assert.equal(us.price, 191.56);
  assert.equal(new Date(us.time).toISOString(), "2026-11-13T21:00:01.000Z"); // 北京时间 11-14 05:00:01
  assert.equal(us.extended.label, "盘后");
  assert.equal(us.extended.price, 192.1);
  assert.equal(new Date(us.extended.time).toISOString(), "2026-11-14T00:59:00.000Z"); // 纽约 19:59
  const fx = quotes.get("FX:USDCNH");
  assert.equal(fx.price, 7.284);
  assert.equal(fx.currency, "CNH");
  assert.equal(fx.name, "美元/人民币（离岸）");
  assert.equal(sinaCode("US:.IXIC"), "gb_ixic");
  assert.equal(sinaCode("HK:HSI"), "rt_hkHSI");
});

test("新浪：盘后价核对不过就不显示；外汇数字不合理就当取不到；空内容是查不到", () => {
  const { quotes, errors } = parseSina([S.usBadExt, S.fxBad, 'var hq_str_sh600000="";'].join("\n"), ["US:MSFT", "FX:AUDCNY", "SH:600000"]);
  assert.equal(quotes.get("US:MSFT").extended, undefined);
  assert.match(errors.get("FX:AUDCNY"), /数据格式变了/);
  assert.equal(errors.get("SH:600000"), "查不到这个代码");
});

// ---------- Finnhub、Twelve Data、Frankfurter ----------
test("Finnhub：正常、查不到、数字对不上", () => {
  const q = parseFinnhub({ c: 191.56, d: 2.93, dp: 1.5533, h: 192, l: 189, o: 189.5, pc: 188.63, t: 1763067601 }, "US:AAPL");
  assert.equal(q.price, 191.56);
  assert.equal(q.source, "finnhub");
  assert.equal(q.currency, "USD");
  assert.equal(q.time, 1763067601000);
  assert.throws(() => parseFinnhub({ c: 0, d: null, dp: null, pc: 0, t: 0 }, "US:NOPE"), /查不到/);
  assert.throws(() => parseFinnhub({ c: 191.56, d: 50, dp: 1.55, pc: 188.63, t: 1 }, "US:AAPL"), FormatError);
});

test("Twelve Data：一个代码、多个代码、其中一个出错", () => {
  const one = parseTwelveData({ symbol: "AUD/CNY", close: "4.65120", previous_close: "4.64000", change: "0.01120", percent_change: "0.24138", timestamp: 1763300000 }, ["FX:AUDCNY"]);
  assert.equal(one.quotes.get("FX:AUDCNY").price, 4.6512);
  assert.equal(one.quotes.get("FX:AUDCNY").currency, "CNY");
  const many = parseTwelveData(
    {
      "AUD/CNY": { symbol: "AUD/CNY", close: "4.65120", previous_close: "4.64000", change: "0.01120", percent_change: "0.24138", timestamp: 1763300000 },
      "USD/CNH": { code: 400, message: "symbol not found", status: "error" },
    },
    ["FX:AUDCNY", "FX:USDCNH"]
  );
  assert.equal(many.quotes.size, 1);
  assert.match(many.errors.get("FX:USDCNH"), /symbol not found/);
});

test("Frankfurter：取最近两天算涨跌，标成每日参考价", () => {
  const data = { amount: 1, base: "AUD", start_date: "2026-11-06", end_date: "2026-11-13", rates: { "2026-11-12": { CNY: 4.64 }, "2026-11-13": { CNY: 4.6512 }, "2026-11-11": { CNY: 4.6 } } };
  const { quotes } = parseFrankfurter(data, ["FX:AUDCNY"]);
  const q = quotes.get("FX:AUDCNY");
  assert.equal(q.price, 4.6512);
  assert.equal(q.reference, true);
  assert.equal(q.delayed, true);
  assert.equal(ttlFor(q, Date.now()), 3600);
});

test("数据源顺序：A 股、港股先腾讯后新浪；美股个股先 Finnhub（有 Key 时）；汇率 Twelve Data → 新浪 → 参考价", () => {
  const keys = { FINNHUB_KEY: "k", TWELVEDATA_KEY: "k" };
  assert.deepEqual(chainFor("SH:600519", keys), ["tencent", "sina"]);
  assert.deepEqual(chainFor("HK:00700", keys), ["tencent", "sina"]);
  assert.deepEqual(chainFor("US:NVDA", keys), ["finnhub", "tencent", "sina"]);
  assert.deepEqual(chainFor("US:NVDA", keys, { lookup: true }), ["tencent", "sina", "finnhub"]); // 添加时要中文名
  assert.deepEqual(chainFor("US:NVDA", {}), ["tencent", "sina"]);
  assert.deepEqual(chainFor("US:.IXIC", keys), ["tencent", "sina"]); // Finnhub 免费档不查指数
  assert.deepEqual(chainFor("FX:AUDCNY", keys), ["twelvedata", "sina", "frankfurter"]);
  assert.deepEqual(chainFor("FX:AUDCNY", {}), ["sina", "frankfurter"]);
});

// ---------- /api/quotes ----------
const ENV = { QUOTES_TOKEN: "test-token-0123456789abcdef", TWELVEDATA_KEY: "td", FINNHUB_KEY: "fh" };
function call(path, { token = ENV.QUOTES_TOKEN, env = ENV, fetcher, now = at("2026-11-16T02:30:00Z"), headers = {} } = {}) {
  const url = new URL("https://callaum.com" + path);
  const h = new Headers(headers);
  if (token) h.set("X-Quotes-Token", token);
  return handleQuotes(new Request(url, { headers: h }), url, env, undefined, { fetcher, now });
}
/** 假的上游：按网址开头给回答，并记下请求了哪些地址 */
function upstream(routes) {
  const seen = [];
  const fetcher = async (url, init) => {
    seen.push({ url: String(url), headers: init?.headers || {} });
    for (const [prefix, reply] of routes) if (String(url).startsWith(prefix)) return typeof reply === "function" ? reply(String(url)) : new Response(reply);
    return new Response("not found", { status: 404 });
  };
  return { fetcher, seen };
}

test("接口：没设口令 503，口令不对 401，不带口令 401；都不去上游", async () => {
  const { fetcher, seen } = upstream([]);
  let res = await call("/api/quotes?ids=SH:600519", { env: {}, fetcher });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, "not_configured");
  res = await call("/api/quotes?ids=SH:600519", { token: "wrong", fetcher });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, "bad_token");
  res = await call("/api/quotes?ids=SH:600519", { token: "", fetcher });
  assert.equal(res.status, 401);
  assert.equal(seen.length, 0);
  assert.equal(res.headers.get("access-control-allow-origin"), null); // 不开跨域
});

test("接口：一次最多 40 个；格式不对的放进 errors，不拖垮整个请求，也不拼进上游地址", async () => {
  const { fetcher, seen } = upstream([["https://qt.gtimg.cn/", () => new Response(gbk(T.maotai))]]);
  let res = await call("/api/quotes?ids=" + Array.from({ length: 41 }, (_, i) => `SH:6000${String(i).padStart(2, "0")}`).join(","), { fetcher });
  assert.equal(res.status, 400);
  res = await call("/api/quotes?ids=" + encodeURIComponent("SH:600519,SH:600519&x,US:<script>,sh:600519"), { fetcher, now: at("2026-11-16T02:31:00Z") });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(data.quotes.map((q) => q.id), ["SH:600519"]);
  assert.deepEqual(data.errors.map((e) => e.reason), ["代码格式不对", "代码格式不对"]);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://qt.gtimg.cn/q=sh600519");
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("接口：主数据源失败自动换备用；每个代码说清楚为什么取不到", async () => {
  const { fetcher, seen } = upstream([
    ["https://qt.gtimg.cn/", new Response("busy", { status: 503 })],
    ["https://hq.sinajs.cn/", () => new Response(gbk(S.hk))],
  ]);
  const res = await call("/api/quotes?ids=HK:00700,SZ:000999", { fetcher, now: at("2026-11-16T03:10:00Z") });
  const data = await res.json();
  assert.deepEqual(data.quotes.map((q) => [q.id, q.source]), [["HK:00700", "sina"]]);
  assert.equal(data.errors.length, 1);
  assert.equal(data.errors[0].id, "SZ:000999");
  assert.match(data.errors[0].reason, /新浪：查不到这个代码/);
  const sinaCall = seen.find((x) => x.url.startsWith("https://hq.sinajs.cn/"));
  assert.equal(sinaCall.headers.Referer, "https://finance.sina.com.cn"); // 新浪必须带 Referer
  assert.equal(sinaCall.url, "https://hq.sinajs.cn/list=rt_hk00700,sz000999");
});

test("接口：同一个代码在缓存有效期内不重复去上游；过期后再取", async () => {
  const { fetcher, seen } = upstream([["https://qt.gtimg.cn/", () => new Response(gbk(T.index))]]);
  const t0 = at("2026-11-16T05:30:00Z"); // 北京时间 13:30，交易中：缓存 1 分钟
  await call("/api/quotes?ids=SH:000001", { fetcher, now: t0 });
  await call("/api/quotes?ids=SH:000001", { fetcher, now: t0 + 30000 });
  assert.equal(seen.length, 1);
  await call("/api/quotes?ids=SH:000001", { fetcher, now: t0 + 61000 });
  assert.equal(seen.length, 2);
  // 添加时查名称（lookup）不用缓存
  await call("/api/quotes?ids=SH:000001&lookup=1", { fetcher, now: t0 + 62000 });
  assert.equal(seen.length, 3);
});

test("接口：美股先问 Finnhub（Key 放在请求头里，不进地址），汇率先问 Twelve Data", async () => {
  const { fetcher, seen } = upstream([
    ["https://finnhub.io/api/v1/quote?symbol=NVDA", JSON.stringify({ c: 150, d: 3, dp: 2.0408, pc: 147, t: 1763067601 })],
    ["https://api.twelvedata.com/quote?symbol=AUD/CNY", JSON.stringify({ symbol: "AUD/CNY", close: "4.65120", previous_close: "4.64000", change: "0.01120", percent_change: "0.24138", timestamp: 1763300000 })],
  ]);
  const res = await call("/api/quotes?ids=US:NVDA,FX:AUDCNY", { fetcher, now: at("2026-11-16T10:00:00Z") });
  const data = await res.json();
  assert.deepEqual(data.quotes.map((q) => q.source), ["finnhub", "twelvedata"]);
  const fh = seen.find((x) => x.url.includes("finnhub"));
  assert.equal(fh.headers["X-Finnhub-Token"], "fh");
  assert.ok(!fh.url.includes("token"));
  const td = seen.find((x) => x.url.includes("twelvedata"));
  assert.equal(td.headers.Authorization, "apikey td");
  assert.ok(!td.url.includes("apikey"));
});

test("自检：不带口令时给一个输入口令的页面；带对口令时返回每个数据源的结果", async () => {
  let res = await call("/api/quotes/selftest", { token: "" });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/html/);
  assert.match(await res.text(), /行情数据源自检/);
  const { fetcher } = upstream([["https://qt.gtimg.cn/", () => new Response(gbk(Object.values(T).join("\n") + "\n" + tencentLine("sz000001", { 1: "平安银行", 2: "000001", 3: "12.00", 4: "11.90", 30: "20261116150003", 31: "0.10", 32: "0.84" })))]]);
  res = await call("/api/quotes/selftest", { fetcher, env: { QUOTES_TOKEN: ENV.QUOTES_TOKEN } });
  const data = await res.json();
  assert.deepEqual(data.keys, { FINNHUB_KEY: false, TWELVEDATA_KEY: false });
  const tc = data.results.find((r) => r.source === "tencent");
  assert.equal(tc.ok, true, JSON.stringify(tc.errors));
  assert.equal(tc.quotes.length, 6);
  assert.match(tc.raw, /v_sh000001/);
  assert.equal(data.results.find((r) => r.source === "finnhub").ok, false);
  res = await call("/api/quotes/selftest", { token: "wrong" });
  assert.equal(res.status, 401);
});
