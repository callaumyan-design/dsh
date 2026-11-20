// 按名称搜行情代码：输入"茅台""腾讯""英伟达""txkg"这类名称、拼音首字母或代码，找出对应的统一代码。
//
// 数据源（都是非官方接口，只在后台调用，格式随时可能变；解析不了就当作没搜到，不会给出错误的代码）：
//   腾讯 smartbox.gtimg.cn（主）：每条形如  市场~代码~名称~拼音~类型，多条用 ^ 分开，名称可能是 \uXXXX 的写法
//   新浪 suggest3.sinajs.cn（备）：每条形如  名称,类型,代码,完整代码,名称,…，多条用 ; 分开
//   Finnhub /search（有 Key、输入是英文时补充美股）：如 apple → AAPL
import { normalizeId, isIndex } from "./market-ids.js";
import { fetchText } from "./quote-sources.js";

const MAX = 10;

/** 把 贵州 这种写法还原成汉字 */
const unescapeU = (s) => String(s || "").replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
const cleanName = (s) => unescapeU(s).replace(/[\u0000-\u001f<>"]/g, "").trim().slice(0, 40);

/** 腾讯的类型 → 要不要、算什么。权证、债券、期货、期权这些不要 */
function tencentKind(type) {
  const t = String(type || "").toUpperCase();
  if (/^ZS/.test(t)) return "指数";
  if (/^(ETF|LOF|JJ|FJ|QDII|KJ)/.test(t)) return "基金";
  if (/^GP/.test(t) || t === "") return "股票";
  return "";
}

/** 腾讯的 市场 + 代码 → 统一代码。kind：这一条是指数时，美股指数代码前面要补一个点（腾讯给的是 ixic，行情接口要 .IXIC） */
function tencentId(market, code, kind) {
  const m = String(market || "").toLowerCase();
  let c = String(code || "").toUpperCase();
  if (m === "us" && kind === "指数" && !c.startsWith(".")) c = "." + c;
  if ((m === "sh" || m === "sz" || m === "bj") && /^\d{6}$/.test(c)) return `${m.toUpperCase()}:${c}`;
  if (m === "hk") return normalizeId(`HK:${c}`);
  if (m === "us") return normalizeId(`US:${c.replace(/\.(OQ|N|AM|PS|O|A|OB)$/, "")}`); // AAPL.OQ → AAPL；.IXIC 保持
  return "";
}

export function parseTencentSearch(text) {
  const m = /v_hint="([^"]*)"/.exec(String(text));
  if (!m) throw new Error("腾讯搜索的返回格式变了");
  if (m[1] === "N" || !m[1]) return [];
  const out = [];
  for (const item of m[1].split("^")) {
    const f = item.split("~");
    if (f.length < 3) continue;
    const kind = tencentKind(f[4]);
    const id = kind && tencentId(f[0], f[1], kind);
    const name = cleanName(f[2]);
    if (id && name && !out.some((x) => x.id === id)) out.push({ id, name, kind: isIndex(id) ? "指数" : kind });
  }
  return out.slice(0, MAX);
}

export async function tencentSearch(q, { fetcher }) {
  const res = await fetchText(fetcher, `https://smartbox.gtimg.cn/s3/?v=2&t=all&c=1&q=${encodeURIComponent(q)}`, { gbk: true, headers: { Referer: "https://gu.qq.com/" } });
  if (!res.ok) throw new Error(`腾讯搜索返回 ${res.status}`);
  return { results: parseTencentSearch(res.text), raw: res.text };
}

/** 新浪的类型：11 A 股、12 B 股、22 ETF、23 LOF、26 封闭基金、31 港股、41 美股；其他不要 */
export function parseSinaSearch(text) {
  const m = /="([^"]*)"/.exec(String(text));
  if (!m) throw new Error("新浪搜索的返回格式变了");
  const out = [];
  for (const item of m[1].split(";")) {
    const f = item.split(",");
    if (f.length < 4) continue;
    const type = f[1];
    let id = "";
    let kind = "股票";
    if (["11", "12", "22", "23", "26"].includes(type) && /^(sh|sz|bj)\d{6}$/.test(f[3])) {
      id = `${f[3].slice(0, 2).toUpperCase()}:${f[3].slice(2)}`;
      if (type !== "11" && type !== "12") kind = "基金";
    } else if (type === "31") id = normalizeId(`HK:${f[2]}`);
    else if (type === "41") id = normalizeId(`US:${f[2]}`);
    const name = cleanName(f[4] || f[0]);
    if (id && name && !out.some((x) => x.id === id)) out.push({ id, name, kind: isIndex(id) ? "指数" : kind });
  }
  return out.slice(0, MAX);
}

export async function sinaSearch(q, { fetcher }) {
  const res = await fetchText(fetcher, `https://suggest3.sinajs.cn/suggest/type=&key=${encodeURIComponent(q)}&name=suggestdata`, { gbk: true, headers: { Referer: "https://finance.sina.com.cn" } });
  if (!res.ok) throw new Error(`新浪搜索返回 ${res.status}`);
  return { results: parseSinaSearch(res.text), raw: res.text };
}

/** Finnhub 的英文搜索：只要美股普通股和 ETF（代码里不带交易所后缀的） */
export function parseFinnhubSearch(data) {
  const list = Array.isArray(data?.result) ? data.result : [];
  const out = [];
  for (const r of list) {
    const symbol = String(r?.symbol || "");
    if (!/^[A-Z]{1,5}(\.[A-Z])?$/.test(symbol) || !/stock|etp|etf/i.test(String(r?.type || ""))) continue;
    const id = normalizeId(`US:${symbol}`);
    if (id && !out.some((x) => x.id === id)) out.push({ id, name: cleanName(r.description), kind: /etp|etf/i.test(r.type) ? "基金" : "股票" });
  }
  return out.slice(0, 5);
}

export async function finnhubSearch(q, { fetcher, env }) {
  if (!env.FINNHUB_KEY) return { results: [], raw: "" };
  const res = await fetchText(fetcher, `https://finnhub.io/api/v1/search?q=${encodeURIComponent(q)}&exchange=US`, { headers: { "X-Finnhub-Token": env.FINNHUB_KEY } });
  if (!res.ok) throw new Error(`Finnhub 搜索返回 ${res.status}`);
  return { results: parseFinnhubSearch(JSON.parse(res.text)), raw: res.text };
}

/** 整理搜索词：去掉首尾空白和控制字符，最长 20 个字；不合适返回空 */
export function cleanQuery(q) {
  const s = String(q || "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return s && s.length <= 20 ? s : "";
}

/**
 * 按名称 / 拼音 / 代码找候选代码（还没有查行情）。返回 { results: [{ id, name, kind }], problems: [] }
 * 腾讯搜不到或出错时换新浪；英文输入再问一下 Finnhub
 */
export async function findCandidates(q, ctx) {
  const results = [];
  const problems = [];
  // 同一个代码被几个接口搜到时，记下它的各种叫法（如"苹果"和 "Apple Inc."），排序时都用来比对
  const push = (list) =>
    list.forEach((x) => {
      const same = results.find((y) => y.id === x.id);
      if (!same) results.push({ ...x, aliases: [] });
      else if (x.name && x.name !== same.name && !same.aliases.includes(x.name)) same.aliases.push(x.name);
    });
  let primary = [];
  try {
    primary = (await tencentSearch(q, ctx)).results;
  } catch (err) {
    problems.push(String(err?.message || err));
  }
  push(primary);
  if (!primary.length) {
    try {
      push((await sinaSearch(q, ctx)).results);
    } catch (err) {
      problems.push(String(err?.message || err));
    }
  }
  if (/^[A-Za-z][A-Za-z .&-]{1,19}$/.test(q)) {
    try {
      push((await finnhubSearch(q, ctx)).results);
    } catch (err) {
      problems.push(String(err?.message || err));
    }
  }
  return { results, problems };
}
