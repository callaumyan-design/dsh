// 行情接口：/api/quotes 和 /api/quotes/selftest。
//
//   GET /api/quotes?ids=SH:600519,HK:00700,US:NVDA,FX:AUDCNY   （设置了口令时，请求头要带 X-Quotes-Token: <口令>）
//   → { quotes: [一条条行情], errors: [{ id, reason }], at: 时间戳 }
//   加 &lookup=1：添加关注时查名称用（优先用有中文名的数据源）
//
//   GET /api/quotes/search?q=茅台   按名称、拼音首字母或代码搜，A 股、港股、美股、汇率一起找，每条带上现价
//   → { results: [{ id, name, kind（股票 / 指数 / 基金 / 汇率）, quote }], at }   只返回查得到行情的
//
//   GET /api/quotes/selftest  在浏览器里直接打开：一个小页面，点一下就检查；页面去要数据时：把每个数据源各查一次，返回结果、耗时和原始样例
//
// 规矩：
//   - 只给本站页面用：不加任何跨域许可（CORS）头；浏览器标明"来自别的网站"的请求直接拒绝，免得别人的网页替你用掉额度。
//   - 访问口令是可选的：Cloudflare 后台没设密钥 QUOTES_TOKEN 时谁都能用；设了以后必须带对口令。
//     Key 存在 FINNHUB_KEY、TWELVEDATA_KEY 里。代码里没有任何密钥。
//   - 一次最多 40 个代码；每个代码先按市场的格式核对，核对过的才会拼进上游地址。
//   - 同一个代码在缓存有效期内不重复去上游取：先看这台服务器的内存，再看 Cloudflare 的缓存（Cache API，
//     只在 callaum.com 这类自己的域名上起作用，workers.dev 上自动跳过）。
import { normalizeId, groupOf, isIndex, fxName, MAX_IDS } from "./market-ids.js";
import { localCandidates, kindOf } from "./market-words.js";
import { marketStatus, isLive } from "./market-hours.js";
import { SOURCES, SOURCE_NAMES, chainFor, sina } from "./quote-sources.js";
import { findCandidates, cleanQuery, tencentSearch, sinaSearch, finnhubSearch } from "./quote-search.js";

const memory = new Map(); // 代码 → { quote, expires }
const MEMORY_MAX = 500;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });

/** 一条行情可以缓存多久（秒）：行情在变的时候 1 分钟，休市、收盘时 15 分钟，每日参考价 1 小时 */
export function ttlFor(quote, now) {
  if (quote.reference) return 3600;
  return isLive(marketStatus(groupOf(quote.id), now, quote.time)) ? 60 : 900;
}

/** 比较口令：先各自算一遍摘要再逐字节比，用时不会因为"前几位猜对了"而变化 */
async function sameToken(given, expected) {
  if (typeof given !== "string" || !given || given.length > 200) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(given)), crypto.subtle.digest("SHA-256", enc.encode(expected))]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

const edgeCache = () => globalThis.caches?.default || null;
const cacheKey = (url, id) => new Request(`${url.origin}/__quote-cache/v1/${encodeURIComponent(id)}`);

async function readCache(url, id, now) {
  const hit = memory.get(id);
  if (hit && hit.expires > now) return hit.quote;
  const cache = edgeCache();
  if (!cache) return null;
  try {
    const res = await cache.match(cacheKey(url, id));
    if (!res) return null;
    const quote = await res.json();
    memory.set(id, { quote, expires: now + ttlFor(quote, now) * 1000 });
    return quote;
  } catch {
    return null;
  }
}

function writeCache(url, quote, now, ctx) {
  const ttl = ttlFor(quote, now);
  if (memory.size >= MEMORY_MAX) memory.delete(memory.keys().next().value);
  memory.set(quote.id, { quote, expires: now + ttl * 1000 });
  const cache = edgeCache();
  if (!cache) return;
  const put = cache.put(cacheKey(url, quote.id), new Response(JSON.stringify(quote), { headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${ttl}` } })).catch(() => {});
  ctx?.waitUntil ? ctx.waitUntil(put) : null;
}

/**
 * 按"主数据源 → 备用数据源"的顺序取一批代码。返回 { quotes: Map, errors: Map }
 * 同一轮里各个数据源同时去取；没取到的进入下一轮，换它的下一个数据源。
 */
export async function resolveQuotes(ids, { env, fetcher, now, lookup = false }) {
  const quotes = new Map();
  const errors = new Map();
  const step = new Map(ids.map((id) => [id, 0]));
  const chains = new Map(ids.map((id) => [id, chainFor(id, env, { lookup })]));
  for (let round = 0; round < 4 && step.size; round++) {
    const bySource = new Map();
    for (const [id, i] of step) {
      const source = chains.get(id)[i];
      if (!source) {
        step.delete(id);
        continue;
      }
      bySource.set(source, [...(bySource.get(source) || []), id]);
    }
    await Promise.all(
      [...bySource].map(async ([source, list]) => {
        let result;
        try {
          result = await SOURCES[source](list, { env, fetcher, now });
        } catch (err) {
          result = { quotes: new Map(), errors: new Map(list.map((id) => [id, String(err?.message || err)])) };
        }
        for (const id of list) {
          if (result.quotes.has(id)) {
            quotes.set(id, result.quotes.get(id));
            errors.delete(id);
            step.delete(id);
          } else {
            errors.set(id, `${SOURCE_NAMES[source]}：${result.errors.get(id) || "没有返回"}`);
            step.set(id, step.get(id) + 1);
          }
        }
      })
    );
  }
  // 美股盘前盘后：主数据源没有这一项，盘前盘后时段再从新浪补（核对不过就不显示）
  const needExtended = [...quotes.values()].filter((q) => groupOf(q.id) === "US" && !isIndex(q.id) && !q.extended && q.source !== "sina");
  const usStatus = marketStatus("US", now);
  if (needExtended.length && (usStatus === "pre" || usStatus === "post")) {
    try {
      const extra = await sina(needExtended.map((q) => q.id), { env, fetcher, now });
      for (const q of needExtended) {
        const ext = extra.quotes.get(q.id)?.extended;
        if (ext && Math.abs(extra.quotes.get(q.id).price - q.price) <= q.price * 0.002) q.extended = ext; // 两家的常规价对得上才用
      }
    } catch {
      /* 补不到就不显示 */
    }
  }
  // 名称：Finnhub 不给名称，用户那边会用添加时记下的中文名
  return { quotes, errors };
}

/** 处理 /api/quotes 和 /api/quotes/selftest */
export async function handleQuotes(request, url, env = {}, ctx, { fetcher = fetch, now = Date.now() } = {}) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  const selftest = url.pathname === "/api/quotes/selftest";
  // 别的网站的网页发来的请求（浏览器会标上 Sec-Fetch-Site: cross-site / same-site）一律不接
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin" && site !== "none") return json({ error: "forbidden", message: "只给本站页面用" }, 403);
  // 在浏览器地址栏里直接打开自检地址：给一个小页面
  if (selftest && (request.headers.get("Accept") || "").includes("text/html")) return selftestPage();
  if (env.QUOTES_TOKEN && !(await sameToken(request.headers.get("X-Quotes-Token"), env.QUOTES_TOKEN))) {
    return json({ error: "bad_token", message: "访问口令不对" }, 401);
  }
  if (selftest) return json(await runSelftest(env, fetcher, now));
  if (url.pathname === "/api/quotes/search") return handleSearch(url, { env, fetcher, now, ctx });

  const raw = (url.searchParams.get("ids") || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (raw.length > MAX_IDS) return json({ error: "too_many", message: `一次最多查 ${MAX_IDS} 个代码` }, 400);
  const errors = [];
  const ids = [];
  for (const item of raw) {
    const id = normalizeId(item);
    if (!id) errors.push({ id: item.slice(0, 24), reason: "代码格式不对" });
    else if (!ids.includes(id)) ids.push(id);
  }
  const lookup = url.searchParams.get("lookup") === "1";
  const { found, errors: failed } = await quotesFor(ids, { url, env, fetcher, now, ctx, lookup, useCache: !lookup });
  return json({ quotes: ids.filter((id) => found.has(id)).map((id) => found.get(id)), errors: [...errors, ...failed], at: now });
}

/** 取一批代码的行情：先看缓存，没有的再去数据源取。返回 { found: Map, errors: [{ id, reason }] } */
async function quotesFor(ids, { url, env, fetcher, now, ctx, lookup = false, useCache = true }) {
  const found = new Map();
  const errors = [];
  const pending = [];
  for (const id of ids) {
    const hit = useCache ? await readCache(url, id, now) : null;
    if (hit) found.set(id, hit);
    else pending.push(id);
  }
  if (pending.length) {
    const result = await resolveQuotes(pending, { env, fetcher, now, lookup });
    for (const [id, quote] of result.quotes) {
      found.set(id, quote);
      writeCache(url, quote, now, ctx);
    }
    for (const [id, reason] of result.errors) errors.push({ id, reason });
  }
  return { found, errors };
}

// ---------- 按名称搜 ----------
const searchMemo = new Map(); // 搜索词 → { body, expires }

async function handleSearch(url, { env, fetcher, now, ctx }) {
  const q = cleanQuery(url.searchParams.get("q"));
  if (!q) return json({ error: "bad_query", message: "搜索词不能为空，最长 20 个字" }, 400);
  const memo = searchMemo.get(q);
  if (memo && memo.expires > now) return json(memo.body);
  // 看一眼就认得出的（代码、汇率）排在前面，然后是腾讯 / 新浪 / Finnhub 搜到的
  const local = localCandidates(q).map((id) => ({ id, name: "", kind: kindOf(id) }));
  const { results: searched, problems } = await findCandidates(q, { env, fetcher, now });
  const candidates = [];
  for (const c of [...local, ...searched]) {
    const same = candidates.find((x) => x.id === c.id);
    if (!same) candidates.push({ ...c });
    else if (!same.name && c.name) Object.assign(same, { name: c.name, kind: c.kind }); // 本地认出的代码，用搜到的中文名
  }
  const ids = candidates.slice(0, 12).map((c) => c.id);
  // 只返回查得到行情的（"查得到才能加"）
  const { found } = await quotesFor(ids, { url, env, fetcher, now, ctx, lookup: true, useCache: true });
  // 排序：名称或代码和搜索词完全一样的最前，其次是开头一样的；基金排在股票和指数后面；其余保持原来的顺序
  const word = q.toUpperCase();
  const rank = (c, quote) => {
    const name = String(quote.name || c.name).toUpperCase();
    const code = c.id.split(":")[1].replace(/^\./, "");
    const match = name === word || code === word ? 0 : name.startsWith(word) || code.startsWith(word) ? 1 : 2;
    return match * 2 + (c.kind === "基金" ? 1 : 0);
  };
  const results = candidates
    .map((c, i) => ({ c, i, quote: found.get(c.id) }))
    .filter((x) => x.quote)
    .sort((a, b) => rank(a.c, a.quote) - rank(b.c, b.quote) || a.i - b.i)
    .slice(0, 8)
    .map(({ c, quote }) => ({
      id: c.id,
      // 名称优先用行情里的正式名称（腾讯搜索给的英文名会被改成小写）
      name: quote.name || c.name || (c.id.startsWith("FX:") ? fxName(c.id) : c.id),
      kind: c.kind || kindOf(c.id),
      quote,
    }));
  const body = { results, at: now, ...(problems.length && !results.length ? { problems } : {}) };
  if (searchMemo.size > 200) searchMemo.delete(searchMemo.keys().next().value);
  searchMemo.set(q, { body, expires: now + 60000 });
  return json(body);
}

// ---------- 自检 ----------
const SELFTEST = {
  tencent: ["SH:000001", "SZ:000001", "HK:00700", "HK:HSI", "US:AAPL", "US:.IXIC"],
  sina: ["SH:600519", "HK:00700", "US:AAPL", "FX:USDCNY", "FX:USDCNH", "FX:AUDCNY"],
  finnhub: ["US:AAPL"],
  twelvedata: ["FX:USDCNY", "FX:AUDCNY"],
  frankfurter: ["FX:AUDCNY"],
};

export async function runSelftest(env, fetcher, now) {
  const results = await Promise.all(
    Object.entries(SELFTEST).map(async ([source, ids]) => {
      const started = Date.now();
      try {
        const r = await SOURCES[source](ids, { env, fetcher, now });
        return {
          source,
          name: SOURCE_NAMES[source],
          ok: r.quotes.size > 0 && r.errors.size === 0,
          ms: Date.now() - started,
          quotes: [...r.quotes.values()],
          errors: [...r.errors].map(([id, reason]) => ({ id, reason })),
          // 原始返回：每行最多 400 个字，最多 10 行（格式变了时对照着改解析）
          raw: String(r.raw || "").split(/\r?\n/).filter((x) => x.trim()).slice(0, 10).map((x) => x.slice(0, 400)).join("\n"),
        };
      } catch (err) {
        return { source, name: SOURCE_NAMES[source], ok: false, ms: Date.now() - started, quotes: [], errors: [{ id: "*", reason: String(err?.message || err) }], raw: "" };
      }
    })
  );
  // 名称搜索各查一次
  const searches = [
    ["tencent-search", "腾讯搜索（茅台）", () => tencentSearch("茅台", { fetcher })],
    ["sina-search", "新浪搜索（腾讯）", () => sinaSearch("腾讯", { fetcher })],
    ["finnhub-search", "Finnhub 搜索（apple）", () => finnhubSearch("apple", { fetcher, env })],
  ];
  for (const [source, name, run] of searches) {
    const started = Date.now();
    try {
      const r = await run();
      results.push({ source, name, ok: r.results.length > 0, ms: Date.now() - started, quotes: r.results.map((x) => ({ id: x.id, name: x.name, kind: x.kind })), errors: [], raw: String(r.raw || "").slice(0, 600) });
    } catch (err) {
      results.push({ source, name, ok: false, ms: Date.now() - started, quotes: [], errors: [{ id: "*", reason: String(err?.message || err) }], raw: "" });
    }
  }
  return { at: now, token: !!env.QUOTES_TOKEN, keys: { FINNHUB_KEY: !!env.FINNHUB_KEY, TWELVEDATA_KEY: !!env.TWELVEDATA_KEY }, results };
}

/** 自检页面：输入口令后由页面带着口令去查（口令不进网址，也不会留在浏览记录里） */
function selftestPage() {
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>行情数据源自检</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:46em;margin:0 auto;padding:20px 16px;color:#0f172a;background:#f8fafc}@media(prefers-color-scheme:dark){body{color:#e2e8f0;background:#0f172a}}
form{display:flex;gap:8px}input{flex:1;font-size:16px;padding:10px;border-radius:10px;border:1px solid #94a3b8}button{font-size:16px;padding:10px 16px;border-radius:10px;border:0;background:#2563eb;color:#fff}
.r{margin:14px 0;padding:12px;border-radius:12px;background:rgba(148,163,184,.15)}.ok{color:#16a34a}.bad{color:#dc2626}pre{white-space:pre-wrap;word-break:break-all;font-size:12px;opacity:.8}</style>
<h1>行情数据源自检</h1><p>把每个数据源各查一次。如果在 Cloudflare 后台设了访问口令（QUOTES_TOKEN），先填上；没设就直接点“开始检查”。</p>
<form id="f"><input id="t" type="password" autocomplete="current-password" placeholder="访问口令（没设置就不用填）"><button>开始检查</button></form><div id="out"></div>
<script>
const out = document.getElementById("out");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
document.getElementById("f").addEventListener("submit", async (e) => {
  e.preventDefault();
  out.textContent = "正在检查…";
  try {
    const headers = { Accept: "application/json" };
    const token = document.getElementById("t").value;
    if (token) headers["X-Quotes-Token"] = token;
    const res = await fetch("selftest", { headers, cache: "no-store" });
    const data = await res.json();
    if (!res.ok) { out.innerHTML = '<p class="bad">' + esc(data.message || res.status) + "</p>"; return; }
    out.innerHTML = "<p>访问口令：" + (data.token ? "已设置" : "未设置（谁都能用）") + "；Key：FINNHUB_KEY " + (data.keys.FINNHUB_KEY ? "已设置" : "未设置") + "，TWELVEDATA_KEY " + (data.keys.TWELVEDATA_KEY ? "已设置" : "未设置") + "</p>" +
      data.results.map((r) => '<div class="r"><b>' + esc(r.name) + '</b> <span class="' + (r.ok ? "ok" : "bad") + '">' + (r.ok ? "正常" : "有问题") + "</span> · " + r.ms + " 毫秒" +
        r.quotes.map((q) => "<div>" + esc(q.price === undefined ? q.id + " " + q.name + "（" + q.kind + "）" : q.id + " " + q.name + " " + q.price + " " + (q.change >= 0 ? "+" : "") + q.change + "（" + q.changePct + "%）" + (q.extended ? " " + q.extended.label + " " + q.extended.price : "") + (q.delayed ? " 延时" : "") + " 时间 " + (q.time ? new Date(q.time).toLocaleString() : "无")) + "</div>").join("") +
        r.errors.map((x) => '<div class="bad">' + esc(x.id + "：" + x.reason) + "</div>").join("") +
        (r.raw ? "<details><summary>原始返回</summary><pre>" + esc(r.raw) + "</pre></details>" : "") + "</div>").join("");
  } catch (err) { out.innerHTML = '<p class="bad">请求失败：' + esc(err.message) + "</p>"; }
});
</script></html>`;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'",
      "Referrer-Policy": "no-referrer",
    },
  });
}
