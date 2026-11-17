// Duo 适配（/duo/）：dsh 仓库里 Duo 追踪器每天自动生成的网页，这里转交给浏览器。
//
// 网页从哪来：
//   - 去 GitHub 读公开仓库 callaumyan-design/dsh 里，Duo 追踪器分支上的 duo-tracker/site/index.html（公开仓库，不用令牌）。
//     追踪器每天北京时间 09:13 左右在 Claude 云端运行，跑完把这份网页连同数据一起推上去；
//     这里检查通过的在这台服务器的内存和 Cloudflare 缓存里各存 10 分钟——推上去以后 10 分钟内页面就跟上，不用重新发布起始页。
//   - GitHub 取不到、或者取到的内容不对时，用发布时打包进来的那份（仓库 duo/index.html，见 tools/refresh-apps.sh）。
//     两份都有时用数据日期新的那份。
//   - 追踪器分支改名或换了位置：在 Cloudflare 后台加一个变量 DUO_REPORT_URL（https 开头的新地址），或者改下面的 REPORT_URL。
//
// 转交前加的东西（不动网页原来的样式、布局和脚本）：
//   - 顶栏最左边加“← 起始页”；
//   - 不再去 Google 下载字体（网页自己写好了系统字体作后备）；
//   - 数据日期比今天（北京时间）早 2 天及以上：顶部红色提示“数据已经 N 天没有更新，可能已过期”
//     （服务器按请求时间算一次，浏览器里再按本机时间算一次，页面开着过夜也准）。
//
// 隔离：和飞汇比价一样，响应头 Content-Security-Policy: sandbox ……，让网页成为一个“没有来历”的页面，
// 它的脚本读不到起始页存在浏览器里的东西（设置、AI 接口 Key 等）——这份网页每天自动更新、里面有从各个网站抓来的文字，没人逐行检查。
// 代价是网页记不住上次用的筛选条件（网页读写浏览器存储时本来就有防护，读不到时照常显示）。

export const REPORT_URL =
  "https://raw.githubusercontent.com/callaumyan-design/dsh/refs/heads/claude/iphone-duo-adapter-tracker-no3gf5/duo-tracker/site/index.html";
export const BUNDLED_PATH = "/duo/index.html";
export const STALE_DAYS = 2;
const TTL = 10 * 60 * 1000; // 从 GitHub 取到的网页用多久再去取新的
const FAIL_PAUSE = 60 * 1000; // GitHub 取不到时，多久以后再试（这期间用手上的那份，不让每次打开都卡 8 秒）
const TIMEOUT = 8000;
const MAX_BYTES = 12 * 1024 * 1024;
const UA = "callaum-start-page/1.0 (duo report sync)";
const DAY = 86400000;
const BEIJING = 8 * 3600000;
export const SANDBOX = "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox";

const DATE_META = /<meta name="duo-tracker:date" content="(\d{4}-\d{2}-\d{2})">/;
const GENERATED_META = /<meta name="duo-tracker:generated" content="([^"]{1,40})">/;
const DATE_SCRIPT = /const DATE = "(\d{4}-\d{2}-\d{2})";/; // 早期的网页没有 meta，只在脚本里写了数据日期

/**
 * 检查一份网页是不是能用的 Duo 适配报告，读出数据日期。不能用返回 null。
 * （GitHub 出错时返回的是一句“404: Not Found”之类的话，不是报告；内容太大、缺少报告的结构、读不出日期的都不要）
 */
export function parseReport(html) {
  if (typeof html !== "string" || !html || html.length > MAX_BYTES) return null;
  if (!html.includes('id="view-apps"') || !html.includes("const APPS = ")) return null;
  const m = DATE_META.exec(html) || DATE_SCRIPT.exec(html);
  if (!m) return null;
  const dayStart = Date.parse(`${m[1]}T00:00:00+08:00`);
  if (!Number.isFinite(dayStart)) return null;
  const g = GENERATED_META.exec(html);
  const generatedAt = g ? Date.parse(g[1]) : NaN;
  return { date: m[1], dayStart, generatedAt: Number.isFinite(generatedAt) ? generatedAt : 0 };
}

/** 数据日期到今天（都按北京时间的日历日）隔了几天 */
export function daysOld(info, now) {
  return Math.max(0, Math.floor((now + BEIJING) / DAY) - Math.floor((info.dayStart + BEIJING) / DAY));
}

const STYLE = `<style>
/* 以下是起始页加的（类名都以 cs- 开头），颜色用网页自己的变量 */
.cs-back { flex: none; color: var(--accent); text-decoration: none; font-size: 13px; font-weight: 500; padding: 6px 0; white-space: nowrap; }
.cs-back:hover { text-decoration: underline; }
.cs-stale { margin: 16px 0 0; padding: 12px 16px; border-radius: 10px; background: var(--st-none, #d24b4b); color: #fff; font-weight: 700; font-size: 15px; }
.cs-stale[hidden] { display: none; }
</style>`;

/** 浏览器里再算一次“隔了几天”：页面可能开着过了夜 */
const SCRIPT = `<script>
(function () {
  var b = document.getElementById("cs-stale");
  if (!b) return;
  var start = Date.parse(b.getAttribute("data-date") + "T00:00:00+08:00");
  if (!isFinite(start)) return;
  var day = 86400000, bj = 8 * 3600000;
  var n = Math.max(0, Math.floor((Date.now() + bj) / day) - Math.floor((start + bj) / day));
  var s = document.getElementById("cs-days");
  if (s) s.textContent = n;
  b.hidden = !(n >= ${STALE_DAYS});
})();
</script>`;

/** 插在第一个 marker 前面（after=true 时插在后面）；找不到 marker 就用 fallback 的位置 */
function insertAt(html, marker, text, { after = false, fallback = "start" } = {}) {
  const i = html.indexOf(marker);
  if (i >= 0) {
    const at = after ? i + marker.length : i;
    return html.slice(0, at) + text + html.slice(at);
  }
  return fallback === "end" ? html + text : text + html;
}

/** 给网页加上“← 起始页”、过期提示，去掉 Google 字体。info 来自 parseReport */
export function decorate(html, info, { now = Date.now() } = {}) {
  const days = daysOld(info, now);
  const stale = days >= STALE_DAYS;
  const back = `<a class="cs-back" href="/">← 起始页</a>\n`;
  const banner =
    `\n<div class="cs-stale" id="cs-stale" role="alert" data-date="${info.date}"${stale ? "" : " hidden"}>` +
    `数据日期是 ${info.date}，已经 <span id="cs-days">${days}</span> 天没有更新，可能已过期</div>`;

  let out = html.replace(/<link[^>]*fonts\.(?:googleapis|gstatic)\.com[^>]*>\s*/g, ""); // 不再去 Google 下载字体
  out = out.includes("</head>") ? insertAt(out, "</head>", STYLE + "\n") : insertAt(out, "</style>", "\n" + STYLE, { after: true });
  out = insertAt(out, '<div class="brand">', back);
  out = insertAt(out, '<main class="wrap">', banner, { after: true });
  out = insertAt(out, "</body>", SCRIPT + "\n", { fallback: "end" });
  return out;
}

// ---------- 取网页 ----------
let memo = null; // 最近一次从 GitHub 取到并检查通过的：{ html, info, at }
let failedAt = 0; // 最近一次从 GitHub 取失败的时间

const edgeCache = () => globalThis.caches?.default || null;
const cacheKey = (url) => new Request(`${url.origin}/__duo-cache/v1/report`);

function sourceUrl(env) {
  const custom = typeof env.DUO_REPORT_URL === "string" ? env.DUO_REPORT_URL.trim() : "";
  return /^https:\/\//.test(custom) ? custom : REPORT_URL;
}

async function fromGitHub({ env, url, fetcher, now, ctx }) {
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
    const res = await fetcher(sourceUrl(env), { signal: ctrl.signal, headers: { Accept: "text/html, text/plain;q=0.9, */*;q=0.1", "User-Agent": UA } });
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const html = await res.text();
    const info = parseReport(html);
    if (!info) throw new Error("内容不是 Duo 适配报告");
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

/** a 是否不比 b 旧：先比数据日期，同一天再比生成时间（一样时算不旧） */
const notOlder = (a, b) => a.info.date > b.info.date || (a.info.date === b.info.date && a.info.generatedAt >= b.info.generatedAt);

/** 测试用：清掉内存里记着的网页和失败时间 */
export function resetDuoMemo() {
  memo = null;
  failedAt = 0;
}

/** 处理 /duo/ 和 /duo/index.html */
export async function handleDuo(request, url, env = {}, ctx, files, { fetcher = fetch, now = Date.now() } = {}) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  const remote = await fromGitHub({ env, url, fetcher, now, ctx });
  const local = bundled(files);
  const pick = remote && (!local || notOlder(remote, local)) ? { ...remote, source: "github" } : local ? { ...local, source: "bundled" } : null;
  const headers = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Content-Security-Policy": SANDBOX,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
  if (!pick) {
    const body = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Duo 适配追踪</title><body style="font:16px/1.6 system-ui,sans-serif;max-width:32em;margin:18vh auto;padding:0 20px;text-align:center"><h1 style="font-size:22px">Duo 适配报告暂时打不开</h1><p>过一会儿再试。<a href="/">回到起始页</a></p></body></html>`;
    return new Response(request.method === "HEAD" ? null : body, { status: 503, headers: { ...headers, "Retry-After": "300" } });
  }
  const body = decorate(pick.html, pick.info, { now });
  return new Response(request.method === "HEAD" ? null : body, {
    status: 200,
    headers: { ...headers, "X-Duo-Source": pick.source, "X-Duo-Date": pick.info.date },
  });
}
