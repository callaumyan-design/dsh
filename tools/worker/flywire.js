// 飞汇地区比价（/flywire/）：私有仓库 flywire-fx-compare 每周自动生成的静态报告，这里转交给浏览器。
//
// 报告从哪来：
//   - Cloudflare 后台设了密钥 FLYWIRE_GITHUB_TOKEN（只读这一个仓库的 GitHub 令牌）时，去 GitHub 读仓库 main 分支上最新的 index.html，
//     检查通过的在这台服务器的内存和 Cloudflare 缓存里各存 10 分钟（仓库更新后 10 分钟内页面就跟上）；
//   - 没设令牌、GitHub 取不到、或者取到的内容不对时，用发布时打包进来的那份（仓库 flywire/index.html，见 tools/refresh-apps.sh）。
//     两份都有时，用抓取时间更新的那份。
//   - 只读 GitHub 上已经生成好的静态页面，从不调用飞汇的接口。
//
// 转交前加的东西（不动报告原来的样式、布局和计算脚本）：
//   - 页头"← 起始页"、页脚；字体换成和起始页一样的系统字体（不再去 Google 下载字体）；补上手机需要的 viewport；
//   - 页面上方一条醒目提示：抓取时间、报价金额，以及"报价随汇率变化，付款前请在飞汇页面再确认金额"；
//   - 抓取时间超过 14 天：红色提示"数据已超过两周未更新，可能已过期"（服务器按请求时间算一次，浏览器里再按本机时间算一次）。
//
// 隔离：响应头 Content-Security-Policy: sandbox ……，让报告页成为一个"没有来历"的页面，
// 它的脚本读不到起始页存在浏览器里的东西（设置、AI 接口 Key 等）。代价是报告记不住上次选的金额和卡种。

export const REPORT_URL = "https://api.github.com/repos/callaumyan-design/flywire-fx-compare/contents/index.html?ref=main";
export const BUNDLED_PATH = "/flywire/index.html";
export const STALE_DAYS = 14;
const TTL = 10 * 60 * 1000; // 从 GitHub 取到的报告用多久再去取新的
const FAIL_PAUSE = 60 * 1000; // GitHub 取不到时，多久以后再试（这期间用手上的那份，不让每次打开都卡 8 秒）
const TIMEOUT = 8000;
const MAX_BYTES = 3 * 1024 * 1024;
const UA = "callaum-start-page/1.0 (flywire report sync)";
const DAY = 86400000;
const FONT_BODY = 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", sans-serif';
const FONT_NUM = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
export const SANDBOX = "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const DATA_RE = /<script id="fw-data" type="application\/json">([\s\S]*?)<\/script>/;

/**
 * 检查一份报告是不是能用的飞汇比价报告，读出抓取时间等信息。不能用返回 null。
 * （GitHub 出错时返回的是一段说明，不是报告；内容太大、没有数据、数据读不出来、抓取时间无效都不要）
 */
export function parseReport(html) {
  if (typeof html !== "string" || !html || html.length > MAX_BYTES) return null;
  const m = DATA_RE.exec(html);
  if (!m) return null;
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || !Array.isArray(data.countries)) return null;
  const scrapedAt = Date.parse(data.scraped_at);
  if (!Number.isFinite(scrapedAt)) return null;
  const rec = data.recipient && typeof data.recipient === "object" ? data.recipient : {};
  return {
    scrapedAt,
    amount: typeof data.amount === "number" && Number.isFinite(data.amount) ? data.amount : null,
    currency: typeof rec.currency === "string" ? rec.currency.slice(0, 8) : "",
    regions: data.countries.length + (Array.isArray(data.failed) ? data.failed.length : 0),
  };
}

/** "3 天前""5 小时前""刚刚" */
export function ageText(ms) {
  if (ms < 3600000) return "刚刚";
  if (ms < DAY) return `${Math.floor(ms / 3600000)} 小时前`;
  return `${Math.floor(ms / DAY)} 天前`;
}

const isStale = (scrapedAt, now) => now - scrapedAt > STALE_DAYS * DAY;

/** 北京时间的"2026年11月17日 16:53"（浏览器里会再换成本机时间） */
function beijingTime(ms) {
  return new Date(ms).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

const STYLE = `<style>
/* 以下是起始页加的（类名都以 cs- 开头），颜色用报告自己的变量 */
:root { --font-body: ${FONT_BODY}; --font-num: ${FONT_NUM}; }
.cs-top { max-width: 1080px; margin: 0 auto; padding: 10px max(16px, env(safe-area-inset-right, 0px)) 0 max(16px, env(safe-area-inset-left, 0px)); display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 14px; }
.cs-top a { color: var(--accent); text-decoration: none; font-weight: 500; padding: 10px 0; }
.cs-top a:hover { text-decoration: underline; }
.cs-top span { color: var(--muted); font-size: 13px; }
.cs-note { display: flex; flex-direction: column; gap: 4px; padding: 12px 16px; border: 1px solid var(--line); border-left: 4px solid var(--warn); border-radius: 10px; background: var(--surface); font-size: 14px; }
.cs-note b { font-weight: 700; }
.cs-stale { padding: 12px 16px; border-radius: 10px; background: var(--bad); color: #fff; font-weight: 700; font-size: 15px; }
.cs-stale[hidden] { display: none; }
.cs-foot { max-width: 1080px; margin: 0 auto; padding: 0 16px 32px; color: var(--muted); font-size: 13px; text-align: center; }
.cs-foot a { color: inherit; }
</style>`;

/** 浏览器里再算一次：按本机时区显示抓取时间，按本机时间判断是否超过两周（页面可能被缓存过） */
const SCRIPT = `<script>
(function () {
  var t = document.getElementById("cs-time");
  if (!t) return;
  var at = Date.parse(t.getAttribute("datetime"));
  if (!isFinite(at)) return;
  try { t.textContent = new Date(at).toLocaleString("zh-CN", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }); } catch (e) {}
  var age = Date.now() - at, day = 86400000;
  var ago = document.getElementById("cs-ago");
  if (ago) ago.textContent = age < 3600000 ? "刚刚" : age < day ? Math.floor(age / 3600000) + " 小时前" : Math.floor(age / day) + " 天前";
  var stale = document.getElementById("cs-stale");
  if (stale) stale.hidden = !(age > ${STALE_DAYS} * day);
})();
</script>`;

/** 给报告加上页头、提示条、页脚和起始页的字体。info 来自 parseReport */
export function decorate(html, info, { now = Date.now() } = {}) {
  const amount = info.amount != null ? `${info.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}${info.currency ? " " + esc(info.currency) : ""}` : "";
  const stale = isStale(info.scrapedAt, now);
  const head = `<!doctype html>\n<html lang="zh-CN">\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<meta name="robots" content="noindex, nofollow">\n`;
  const top = `<nav class="cs-top" aria-label="起始页"><a href="/">← 起始页</a><span>飞汇地区比价</span></nav>\n`;
  const note =
    `<div class="cs-note" role="note"><p>数据抓取于 <b><time id="cs-time" datetime="${new Date(info.scrapedAt).toISOString()}">${esc(beijingTime(info.scrapedAt))}（北京时间）</time></b>（<span id="cs-ago">${ageText(Math.max(0, now - info.scrapedAt))}</span>）` +
    `${amount ? `，按 <b>${amount}</b> 报价` : ""}，每周一自动更新。</p><p>报价随汇率变化，付款前请在飞汇页面再确认金额。</p></div>\n` +
    `<div class="cs-stale" id="cs-stale" role="alert"${stale ? "" : " hidden"}>数据已超过两周未更新，可能已过期</div>\n`;
  const foot = `<footer class="cs-foot"><a href="/">callaum.com 起始页</a> · 报告由 flywire-fx-compare 每周自动生成</footer>\n`;

  let out = html.replace(/<link[^>]*fonts\.(?:googleapis|gstatic)\.com[^>]*>\s*/g, ""); // 不再去 Google 下载字体
  const styleEnd = out.indexOf("</style>");
  out = styleEnd >= 0 ? out.slice(0, styleEnd + 8) + "\n" + STYLE + out.slice(styleEnd + 8) : STYLE + out;
  const wrap = out.indexOf('<div class="wrap">');
  if (wrap >= 0) {
    const inner = wrap + '<div class="wrap">'.length;
    out = out.slice(0, wrap) + top + out.slice(wrap, inner) + "\n" + note + out.slice(inner);
  } else {
    out = top + note + out;
  }
  const data = out.indexOf('<script id="fw-data"');
  out = data >= 0 ? out.slice(0, data) + foot + out.slice(data) : out + foot;
  return head + out + "\n" + SCRIPT + "\n";
}

// ---------- 取报告 ----------
let memo = null; // 最近一次从 GitHub 取到并检查通过的：{ html, info, at }
let failedAt = 0; // 最近一次从 GitHub 取失败的时间

const edgeCache = () => globalThis.caches?.default || null;
const cacheKey = (url) => new Request(`${url.origin}/__flywire-cache/v1/report`);

async function fromGitHub({ env, url, fetcher, now, ctx }) {
  const token = typeof env.FLYWIRE_GITHUB_TOKEN === "string" ? env.FLYWIRE_GITHUB_TOKEN.trim() : "";
  if (!token) return null;
  if (memo && now - memo.at < TTL) return memo;
  // 这台服务器上没有：看 Cloudflare 缓存（不同服务器之间共用）
  const cache = edgeCache();
  if (!memo && cache) {
    try {
      const hit = await cache.match(cacheKey(url));
      if (hit) {
        const html = await hit.text();
        const info = parseReport(html);
        const at = Number(hit.headers.get("X-Fetched-At")) || 0;
        if (info) memo = { html, info, at };
        if (info && now - at < TTL) return memo;
      }
    } catch {
      /* 缓存读不了就直接去 GitHub */
    }
  }
  if (now - failedAt < FAIL_PAUSE) return memo; // 刚失败过：先用手上的（可能是旧的，也可能没有）
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetcher(REPORT_URL, {
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.raw", "User-Agent": UA, "X-GitHub-Api-Version": "2022-11-28" },
    });
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const html = await res.text();
    const info = parseReport(html);
    if (!info) throw new Error("内容不是比价报告");
    memo = { html, info, at: now };
    failedAt = 0;
    if (cache) {
      const put = cache
        .put(cacheKey(url), new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "X-Fetched-At": String(now), "Cache-Control": "max-age=604800" } }))
        .catch(() => {});
      ctx?.waitUntil?.(put);
    }
    return memo;
  } catch {
    failedAt = now;
    return memo; // 取不到：有以前取到的就用以前的
  } finally {
    clearTimeout(timer);
  }
}

function bundled(files) {
  const file = files?.get?.(BUNDLED_PATH);
  if (!file) return null;
  const html = typeof file.body === "string" ? file.body : new TextDecoder().decode(file.body);
  const info = parseReport(html);
  return info ? { html, info } : null;
}

/** 测试用：清掉内存里记着的报告和失败时间 */
export function resetFlywireMemo() {
  memo = null;
  failedAt = 0;
}

/** 处理 /flywire/ 和 /flywire/index.html */
export async function handleFlywire(request, url, env = {}, ctx, files, { fetcher = fetch, now = Date.now() } = {}) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  const remote = await fromGitHub({ env, url, fetcher, now, ctx });
  const local = bundled(files);
  // 两份都有时用抓取时间更新的那份
  const pick = remote && (!local || remote.info.scrapedAt >= local.info.scrapedAt) ? { ...remote, source: "github" } : local ? { ...local, source: "bundled" } : null;
  const headers = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Content-Security-Policy": SANDBOX,
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
  if (!pick) {
    const body = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>飞汇地区比价</title><body style="font:16px/1.6 system-ui,sans-serif;max-width:32em;margin:18vh auto;padding:0 20px;text-align:center"><h1 style="font-size:22px">比价报告暂时打不开</h1><p>过一会儿再试。<a href="/">回到起始页</a></p></body></html>`;
    return new Response(request.method === "HEAD" ? null : body, { status: 503, headers: { ...headers, "Retry-After": "300" } });
  }
  const body = decorate(pick.html, pick.info, { now });
  return new Response(request.method === "HEAD" ? null : body, { status: 200, headers: { ...headers, "X-Flywire-Source": pick.source } });
}
