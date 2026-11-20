// 行情数据源：怎么去各家取数据、怎么把返回的内容解析成统一格式。
//
// 统一格式（一条行情）：
//   { id, name, price, change, changePct, currency, time（最新成交时间，毫秒时间戳）, delayed（是否延时）,
//     reference（是否"每日参考价"）, source（数据源名）, extended?（美股盘前/盘后：{ label, price, change, changePct, time }) }
//
// 腾讯、新浪是非官方接口，格式随时可能变：这里解析时处处核对（代码对不对得上、涨跌额和涨跌幅
// 和现价、昨收算出来的对不对得上），对不上就当作"取不到"，绝不把可能错位的数字显示出来。
import { normalizeId, isIndex, fxName, groupOf } from "./market-ids.js";
import { zonedToEpoch, ZONES } from "./market-hours.js";

const TIMEOUT = 5000;
const UA = "start-page-quotes/1.0";

/** 数据格式和预想的不一样 */
export class FormatError extends Error {}

/** 取一段文字。gbk：腾讯、新浪返回的是 GBK 编码 */
export async function fetchText(fetcher, url, { headers = {}, gbk = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetcher(url, { headers: { "User-Agent": UA, ...headers }, signal: controller.signal });
    const bytes = await res.arrayBuffer();
    const text = new TextDecoder(gbk ? "gbk" : "utf-8").decode(bytes);
    return { status: res.status, ok: res.ok, text };
  } catch (err) {
    throw new Error(controller.signal.aborted ? "等了 5 秒没有回应" : `连不上（${String(err?.message || err).slice(0, 80)}）`);
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 通用的核对 ----------
const num = (v) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * 核对一组数：现价、昨收必须是正数；给了涨跌额和涨跌幅的，必须和"现价 - 昨收"算出来的对得上。
 * 返回 { price, prev, change, changePct }
 */
export function checkNumbers({ price, prev, change, changePct }) {
  price = num(price);
  prev = num(prev);
  if (!(price > 0) || !(prev > 0)) throw new FormatError(`现价或昨收不对（${price} / ${prev}）`);
  const expected = price - prev;
  const c = num(change);
  if (Number.isFinite(c) && Math.abs(c - expected) > Math.max(0.011, prev * 0.0002)) throw new FormatError(`涨跌额对不上（${c}，应为 ${round(expected, 4)}）`);
  const pctExpected = (expected / prev) * 100;
  const p = num(changePct);
  if (Number.isFinite(p) && Math.abs(p - pctExpected) > Math.max(0.02, Math.abs(pctExpected) * 0.01)) throw new FormatError(`涨跌幅对不上（${p}，应为 ${round(pctExpected, 3)}）`);
  return { price, prev, change: round(expected, 6), changePct: round(pctExpected, 4) };
}

/** 解析各种写法的时间（都是交易所当地时间）：20261116150003、2026/11/16 16:08:46、2026-11-13 16:00:01 */
export function parseLocalTime(text, zone) {
  const s = String(text || "").trim();
  let m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(s);
  if (m) return zonedToEpoch(zone, `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`);
  m = /^(\d{4})[/-](\d{2})[/-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (m) return zonedToEpoch(zone, `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6] || "00"}`);
  return NaN;
}

const currencyOf = (id) => {
  if (isIndex(id)) return ""; // 指数没有币种，单位是"点"
  const market = id.split(":")[0];
  if (market === "FX") return id.slice(6);
  return { SH: "CNY", SZ: "CNY", BJ: "CNY", HK: "HKD", US: "USD" }[market] || "";
};

/** 哪个数据源的哪个市场是延时行情。以实际情况为准：部署后用自检接口核对，需要时改这里 */
export const DELAYED = {
  // 2026-11-16 用线上自检核对过：腾讯、新浪的美股成交时间和当时的纽约时间一致（看不出延时）；
  // 港股免费行情通常延时约 15 分钟，先按延时标
  tencent: { A: false, HK: true, US: false },
  sina: { A: false, HK: true, US: false, FX: false },
  finnhub: { US: false },
  twelvedata: { FX: false },
  frankfurter: { FX: true },
};

function quote(id, source, name, numbers, time, extra = {}) {
  return {
    id,
    name: String(name || "").trim().slice(0, 40) || (groupOf(id) === "FX" ? fxName(id) : ""),
    price: numbers.price,
    change: numbers.change,
    changePct: numbers.changePct,
    currency: currencyOf(id),
    time: Number.isFinite(time) ? time : null,
    delayed: !!DELAYED[source]?.[groupOf(id)],
    reference: false,
    source,
    ...extra,
  };
}

/** 一批代码里的每一个都记一个同样的错误 */
const failAll = (ids, reason) => new Map(ids.map((id) => [id, reason]));

// ---------- 腾讯（qt.gtimg.cn）：A 股、港股、美股、指数，一次查多个，不用 Key ----------
// 每行形如 v_sh600519="1~贵州茅台~600519~现价~昨收~今开~…";，用 ~ 分隔：
//   [1] 名称  [2] 代码  [3] 现价  [4] 昨收  [30] 最新时间  [31] 涨跌额  [32] 涨跌幅
export function tencentCode(id) {
  const [market, code] = id.split(":");
  if (market === "SH" || market === "SZ" || market === "BJ") return market.toLowerCase() + code;
  if (market === "HK") return "hk" + code;
  if (market === "US") return "us" + code; // 指数本身带点：us.IXIC
  return "";
}

export function parseTencent(text, ids) {
  const quotes = new Map();
  const errors = new Map();
  const lines = new Map();
  for (const m of String(text).matchAll(/v_([A-Za-z0-9.]+)="([^"]*)"/g)) lines.set(m[1], m[2]);
  for (const id of ids) {
    const code = tencentCode(id);
    const raw = lines.get(code);
    if (raw == null || raw === "" || raw === "1") {
      errors.set(id, "查不到这个代码");
      continue;
    }
    try {
      const f = raw.split("~");
      if (f.length < 33) throw new FormatError(`字段太少（${f.length}）`);
      const want = id.split(":")[1].toUpperCase();
      const got = f[2].toUpperCase();
      if (got !== want && !got.startsWith(want + ".")) throw new FormatError(`代码对不上（${f[2]}）`);
      const group = groupOf(id);
      const numbers = checkNumbers({ price: f[3], prev: f[4], change: f[31], changePct: f[32] });
      const time = parseLocalTime(f[30], ZONES[group]);
      if (!Number.isFinite(time)) throw new FormatError(`时间看不懂（${f[30]}）`);
      quotes.set(id, quote(id, "tencent", f[1], numbers, time));
    } catch (err) {
      errors.set(id, err instanceof FormatError ? `数据格式变了：${err.message}` : "解析出错");
    }
  }
  return { quotes, errors };
}

export async function tencent(ids, { fetcher }) {
  const codes = ids.map(tencentCode).filter(Boolean);
  const res = await fetchText(fetcher, `https://qt.gtimg.cn/q=${codes.join(",")}`, { gbk: true, headers: { Referer: "https://gu.qq.com/" } });
  if (!res.ok) return { quotes: new Map(), errors: failAll(ids, `腾讯返回 ${res.status}`), raw: res.text };
  return { ...parseTencent(res.text, ids), raw: res.text };
}

// ---------- 新浪（hq.sinajs.cn）：必须 https 并带 Referer，只能在后台调用 ----------
export function sinaCode(id) {
  const [market, code] = id.split(":");
  if (market === "SH" || market === "SZ" || market === "BJ") return market.toLowerCase() + code;
  if (market === "HK") return "rt_hk" + code;
  if (market === "US") return "gb_" + code.replace(/^\./, "").replace(/\./g, "$").toLowerCase();
  if (market === "FX") return "fx_s" + code.toLowerCase();
  return "";
}

const findIndex = (f, re, from = 0) => {
  for (let i = from; i < f.length; i++) if (re.test(f[i])) return i;
  return -1;
};

/** 新浪美股的盘前盘后：时间形如 "Nov 13 07:59PM EST"。核对不过就不要 */
function sinaExtended(f, regularPrice, regularTime) {
  const t = /^([A-Z][a-z]{2}) (\d{1,2}) (\d{1,2}):(\d{2})(AM|PM) E[SD]T$/.exec(String(f[24] || "").trim());
  if (!t) return null;
  const price = num(f[21]);
  const pct = num(f[22]);
  const change = num(f[23]);
  if (!(price > 0) || !Number.isFinite(pct) || !Number.isFinite(change)) return null;
  if (Math.abs(change - (price - regularPrice)) > Math.max(0.011, regularPrice * 0.0002)) return null;
  if (Math.abs(pct - (change / regularPrice) * 100) > 0.05) return null;
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(t[1]) + 1;
  if (!month) return null;
  let hour = Number(t[3]) % 12;
  if (t[5] === "PM") hour += 12;
  const year = new Date(regularTime || Date.now()).getUTCFullYear();
  const pad = (n) => String(n).padStart(2, "0");
  const time = zonedToEpoch("America/New_York", `${year}-${pad(month)}-${pad(Number(t[2]))} ${pad(hour)}:${t[4]}:00`);
  if (!Number.isFinite(time)) return null;
  const minutes = hour * 60 + Number(t[4]);
  return { label: minutes < 9 * 60 + 30 ? "盘前" : "盘后", price, change: round(price - regularPrice, 6), changePct: round(((price - regularPrice) / regularPrice) * 100, 4), time };
}

export function parseSina(text, ids) {
  const quotes = new Map();
  const errors = new Map();
  const lines = new Map();
  for (const m of String(text).matchAll(/hq_str_([A-Za-z0-9_$]+)="([^"]*)"/g)) lines.set(m[1], m[2]);
  for (const id of ids) {
    const raw = lines.get(sinaCode(id));
    if (!raw) {
      errors.set(id, "查不到这个代码");
      continue;
    }
    try {
      const f = raw.split(",");
      const market = id.split(":")[0];
      let q;
      if (market === "SH" || market === "SZ" || market === "BJ") {
        // [0] 名称 [1] 今开 [2] 昨收 [3] 现价 … [30] 日期 [31] 时间
        if (f.length < 32) throw new FormatError(`字段太少（${f.length}）`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(f[30]) || !/^\d{2}:\d{2}:\d{2}$/.test(f[31])) throw new FormatError("日期时间不在预想的位置");
        const numbers = checkNumbers({ price: f[3], prev: f[2] });
        q = quote(id, "sina", f[0], numbers, zonedToEpoch(ZONES.A, `${f[30]} ${f[31]}`));
      } else if (market === "HK") {
        // [0] 英文名 [1] 中文名 [2] 今开 [3] 昨收 [4] 最高 [5] 最低 [6] 现价 [7] 涨跌额 [8] 涨跌幅 … 日期 YYYY/MM/DD、时间 HH:MM
        if (f.length < 19) throw new FormatError(`字段太少（${f.length}）`);
        const d = findIndex(f, /^\d{4}\/\d{2}\/\d{2}$/, 9);
        if (d < 0 || !/^\d{1,2}:\d{2}(:\d{2})?$/.test(f[d + 1] || "")) throw new FormatError("找不到日期时间");
        const numbers = checkNumbers({ price: f[6], prev: f[3], change: f[7], changePct: f[8] });
        const time = parseLocalTime(`${f[d]} ${f[d + 1].padStart(5, "0")}`, ZONES.HK);
        q = quote(id, "sina", f[1], numbers, time);
      } else if (market === "US") {
        // [0] 名称 [1] 现价 [2] 涨跌幅 [3] 时间（北京时间） [4] 涨跌额 … [21]~[24] 盘前盘后
        if (f.length < 5) throw new FormatError(`字段太少（${f.length}）`);
        const price = num(f[1]);
        const change = num(f[4]);
        const numbers = checkNumbers({ price, prev: price - change, change, changePct: f[2] });
        const time = parseLocalTime(f[3], ZONES.A);
        if (!Number.isFinite(time)) throw new FormatError(`时间看不懂（${f[3]}）`);
        // 盘前盘后价比常规交易的成交更新时才显示（交易时段里那几格放的是上一次的盘后价，不要）
        const ext = isIndex(id) || f.length < 25 ? null : sinaExtended(f, numbers.price, time);
        const extended = ext && ext.time > time ? ext : null;
        q = quote(id, "sina", f[0], numbers, time, extended ? { extended } : {});
      } else if (market === "FX") {
        // [0] 时间 [1] 买价 [2] 卖价 [3] 昨收 … [8] 最新价 [9] 名称 … 最后是日期
        if (f.length < 10 || !/^\d{2}:\d{2}:\d{2}$/.test(f[0])) throw new FormatError("时间不在预想的位置");
        const price = num(f[8]);
        const bid = num(f[1]);
        if (!(price > 0) || !(bid > 0) || Math.abs(bid / price - 1) > 0.01) throw new FormatError("买价和最新价对不上");
        const numbers = checkNumbers({ price, prev: f[3] });
        if (Math.abs(numbers.changePct) > 10) throw new FormatError("涨跌幅不合常理");
        const date = [...f].reverse().find((x) => /^\d{4}-\d{2}-\d{2}$/.test(x));
        q = quote(id, "sina", fxName(id), numbers, date ? zonedToEpoch(ZONES.A, `${date} ${f[0]}`) : NaN);
      } else throw new FormatError("不支持的市场");
      quotes.set(id, q);
    } catch (err) {
      errors.set(id, err instanceof FormatError ? `数据格式变了：${err.message}` : "解析出错");
    }
  }
  return { quotes, errors };
}

export async function sina(ids, { fetcher }) {
  const codes = ids.map(sinaCode).filter(Boolean);
  const res = await fetchText(fetcher, `https://hq.sinajs.cn/list=${codes.join(",")}`, { gbk: true, headers: { Referer: "https://finance.sina.com.cn" } });
  if (!res.ok) return { quotes: new Map(), errors: failAll(ids, `新浪返回 ${res.status}`), raw: res.text };
  return { ...parseSina(res.text, ids), raw: res.text };
}

// ---------- Finnhub：美股个股（官方接口，要 Key；免费档每分钟 60 次，一个代码一次） ----------
// 返回 { c 现价, d 涨跌额, dp 涨跌幅, h, l, o, pc 昨收, t 时间（秒） }；查不到的代码各项都是 0
export function parseFinnhub(data, id) {
  if (!data || typeof data !== "object") throw new FormatError("不是预想的格式");
  if (data.c === 0 && data.pc === 0) throw new Error("查不到这个代码");
  const numbers = checkNumbers({ price: data.c, prev: data.pc, change: data.d, changePct: data.dp });
  const t = num(data.t);
  return quote(id, "finnhub", "", numbers, t > 0 ? t * 1000 : NaN);
}

const FINNHUB_MAX = 20; // 一次最多查多少个（每个代码都是一次请求，免费档一次调用最多 50 个外部请求）

export async function finnhub(ids, { fetcher, env }) {
  const quotes = new Map();
  const errors = new Map();
  if (!env.FINNHUB_KEY) return { quotes, errors: failAll(ids, "没有设置 FINNHUB_KEY"), raw: "" };
  let raw = "";
  await Promise.all(
    ids.map(async (id, i) => {
      if (i >= FINNHUB_MAX) return errors.set(id, "这次要查的美股太多，改用备用数据源");
      try {
        const symbol = encodeURIComponent(id.slice(3));
        const res = await fetchText(fetcher, `https://finnhub.io/api/v1/quote?symbol=${symbol}`, { headers: { "X-Finnhub-Token": env.FINNHUB_KEY } });
        if (!raw) raw = res.text;
        if (res.status === 401 || res.status === 403) throw new Error("FINNHUB_KEY 不对或没有权限");
        if (res.status === 429) throw new Error("Finnhub 请求太频繁");
        if (!res.ok) throw new Error(`Finnhub 返回 ${res.status}`);
        quotes.set(id, parseFinnhub(JSON.parse(res.text), id));
      } catch (err) {
        errors.set(id, err instanceof FormatError ? `数据格式变了：${err.message}` : String(err?.message || err));
      }
    })
  );
  return { quotes, errors, raw };
}

// ---------- Twelve Data：汇率（官方接口，要 Key；免费档每分钟 8 次、每天 800 次，按代码计） ----------
export const tdSymbol = (id) => `${id.slice(3, 6)}/${id.slice(6, 9)}`;

export function parseTwelveData(data, ids) {
  const quotes = new Map();
  const errors = new Map();
  if (!data || typeof data !== "object") return { quotes, errors: failAll(ids, "数据格式变了") };
  // 只查一个代码时直接返回那一项；查多个时按代码分开
  const single = ids.length === 1 && !data[tdSymbol(ids[0])];
  for (const id of ids) {
    const item = single ? data : data[tdSymbol(id)];
    try {
      if (!item || typeof item !== "object") throw new Error("没有返回这一项");
      if (item.status === "error") throw new Error(`Twelve Data：${String(item.message || "出错").slice(0, 120)}`);
      if (item.symbol && item.symbol !== tdSymbol(id)) throw new FormatError(`代码对不上（${item.symbol}）`);
      const numbers = checkNumbers({ price: item.close, prev: item.previous_close, change: item.change, changePct: item.percent_change });
      const t = num(item.last_quote_at ?? item.timestamp);
      quotes.set(id, quote(id, "twelvedata", fxName(id), numbers, t > 0 ? t * 1000 : NaN));
    } catch (err) {
      errors.set(id, err instanceof FormatError ? `数据格式变了：${err.message}` : String(err?.message || err));
    }
  }
  return { quotes, errors };
}

const TD_PER_MINUTE = 8;
const tdUsage = []; // 最近一分钟用掉的次数（只在这台服务器的内存里，尽力而为）

export async function twelvedata(ids, { fetcher, env, now }) {
  if (!env.TWELVEDATA_KEY) return { quotes: new Map(), errors: failAll(ids, "没有设置 TWELVEDATA_KEY"), raw: "" };
  while (tdUsage.length && tdUsage[0] < now - 60000) tdUsage.shift();
  const room = Math.max(0, TD_PER_MINUTE - tdUsage.length);
  const use = ids.slice(0, room);
  const errors = failAll(ids.slice(room), "这一分钟的 Twelve Data 额度用完了，改用备用数据源");
  if (!use.length) return { quotes: new Map(), errors, raw: "" };
  for (let i = 0; i < use.length; i++) tdUsage.push(now);
  const res = await fetchText(fetcher, `https://api.twelvedata.com/quote?symbol=${use.map(tdSymbol).join(",")}`, { headers: { Authorization: `apikey ${env.TWELVEDATA_KEY}` } });
  let data = null;
  try {
    data = JSON.parse(res.text);
  } catch {
    /* 下面按格式不对处理 */
  }
  if (!res.ok || (data && data.status === "error" && data.code)) {
    const reason = res.status === 401 || data?.code === 401 ? "TWELVEDATA_KEY 不对" : res.status === 429 || data?.code === 429 ? "Twelve Data 额度用完了" : `Twelve Data 返回 ${data?.code || res.status}`;
    return { quotes: new Map(), errors: new Map([...errors, ...failAll(use, reason)]), raw: res.text };
  }
  const parsed = parseTwelveData(data, use);
  return { quotes: parsed.quotes, errors: new Map([...errors, ...parsed.errors]), raw: res.text };
}

// ---------- Frankfurter：欧洲央行的参考汇率（不用 Key；每天更新一次，没有离岸人民币 CNH） ----------
const ECB = new Set(["USD", "JPY", "CZK", "DKK", "GBP", "HUF", "PLN", "RON", "SEK", "CHF", "ISK", "NOK", "TRY", "AUD", "BRL", "CAD", "CNY", "HKD", "IDR", "ILS", "INR", "KRW", "MXN", "MYR", "NZD", "PHP", "SGD", "THB", "ZAR", "EUR"]);

export function parseFrankfurter(data, ids) {
  const quotes = new Map();
  const errors = new Map();
  const dates = Object.keys(data?.rates || {}).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  for (const id of ids) {
    try {
      const target = id.slice(6);
      const [prevDate, lastDate] = dates.slice(-2);
      const last = num(data.rates?.[lastDate]?.[target]);
      const prev = num(data.rates?.[prevDate]?.[target]);
      if (!lastDate || !prevDate) throw new FormatError("日期不够");
      const numbers = checkNumbers({ price: last, prev });
      const time = zonedToEpoch("Europe/Berlin", `${lastDate} 16:00:00`);
      quotes.set(id, quote(id, "frankfurter", fxName(id), numbers, time, { reference: true }));
    } catch (err) {
      errors.set(id, err instanceof FormatError ? `数据格式变了：${err.message}` : "解析出错");
    }
  }
  return { quotes, errors };
}

export async function frankfurter(ids, { fetcher, now }) {
  const quotes = new Map();
  const errors = new Map();
  const byBase = new Map();
  for (const id of ids) {
    const base = id.slice(3, 6);
    const target = id.slice(6, 9);
    if (!ECB.has(base) || !ECB.has(target)) errors.set(id, "参考汇率里没有这个币种（离岸人民币 CNH 只能用实时行情）");
    else byBase.set(base, [...(byBase.get(base) || []), id]);
  }
  let raw = "";
  const start = new Date(now - 10 * 86400000).toISOString().slice(0, 10);
  await Promise.all(
    [...byBase].map(async ([base, list]) => {
      try {
        const symbols = [...new Set(list.map((id) => id.slice(6, 9)))].join(",");
        const res = await fetchText(fetcher, `https://api.frankfurter.dev/v1/${start}..?base=${base}&symbols=${symbols}`);
        if (!raw) raw = res.text;
        if (!res.ok) throw new Error(`Frankfurter 返回 ${res.status}`);
        const parsed = parseFrankfurter(JSON.parse(res.text), list);
        parsed.quotes.forEach((v, k) => quotes.set(k, v));
        parsed.errors.forEach((v, k) => errors.set(k, v));
      } catch (err) {
        list.forEach((id) => errors.set(id, String(err?.message || err)));
      }
    })
  );
  return { quotes, errors, raw };
}

export const SOURCES = { tencent, sina, finnhub, twelvedata, frankfurter };
export const SOURCE_NAMES = { tencent: "腾讯", sina: "新浪", finnhub: "Finnhub", twelvedata: "Twelve Data", frankfurter: "欧洲央行参考价（Frankfurter）" };

/** 每个代码依次试哪些数据源。lookup：添加时查名称，优先用有中文名的数据源 */
export function chainFor(id, env, { lookup = false } = {}) {
  const group = groupOf(id);
  if (group === "A" || group === "HK") return ["tencent", "sina"];
  if (group === "US") {
    if (isIndex(id) || !env.FINNHUB_KEY) return ["tencent", "sina"];
    return lookup ? ["tencent", "sina", "finnhub"] : ["finnhub", "tencent", "sina"];
  }
  if (group === "FX") return [...(env.TWELVEDATA_KEY ? ["twelvedata"] : []), "sina", "frankfurter"];
  return [];
}

export { normalizeId };
