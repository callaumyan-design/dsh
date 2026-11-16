// Service Worker：让起始页可以"添加到主屏幕"，并在断网时也能打开。
//
// 起始页自己的文件分两类：
//   1. 页面本身（首页、/about/、清单、图标）——"网络优先"：有网就向服务器确认拿最新的，没网才用上次存下的。
//   2. 样式、脚本、配置——线上的地址前面带着版本号（v/版本号/…，见 tools/deploy-cloudflare.mjs）。
//      同一个地址的内容永远不变，所以"存过就直接用"；发了新版，首页里的地址跟着变，自然会去取新的。
//      （在本机预览、或者放在没有版本号的地方时，这类文件也按"网络优先"处理。）
// 其他一律不经手：站外请求（搜索引擎、壁纸、AI 接口）、本站的接口（/api/…，比如行情），
// 以及同一个域名下别的应用（如 /duo/、/uq/）的页面和接口。
const CACHE = "start-page-v7";

// 页面本身：安装时预先存好
const PAGES = [
  "./",
  "about/",
  "manifest.webmanifest",
  "assets/icons/favicon.svg",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/apps/duo.svg",
  "assets/icons/apps/catgpt.svg",
  "assets/icons/apps/uq.svg",
  "assets/icons/apps/yanlu.svg",
  "assets/icons/apps/wifidrop.svg",
];

// 样式、脚本、配置：每个版本各存一份（由页面告诉这里"现在是哪一版"）
const FILES = [
  "config/nav.js",
  "config/site.js",
  "assets/css/main.css",
  "assets/js/boot.js",
  "assets/js/main.js",
  "assets/js/store.js",
  "assets/js/ui.js",
  "assets/js/icons.js",
  "assets/js/idb.js",
  "assets/js/background.js",
  "assets/js/widgets.js",
  "assets/js/typography.js",
  "assets/js/engines.js",
  "assets/js/search.js",
  "assets/js/nav.js",
  "assets/js/nav-model.js",
  "assets/js/nav-edit.js",
  "assets/js/backup.js",
  "assets/js/settings-panel.js",
  "assets/js/ai/link.js",
  "assets/js/market/ids.js",
  "assets/js/market/hours.js",
  "assets/js/market/trigger.js",
  "assets/js/market/auth.js",
  "assets/js/market/card.js",
  "assets/js/market/demo.js",
  "assets/css/market.css",
  "assets/js/ai/api.js",
  "assets/js/ai/api-tools.js",
  "assets/js/ai/auth.js",
  "assets/js/ai/client.js",
  "assets/js/ai/markdown.js",
  "assets/js/ai/panel.js",
];

const BASE = new URL("./", self.location).pathname; // 起始页所在的目录，如 "/" 或 "/dsh/"
const BUILD_ID = /^[A-Za-z0-9]{1,40}$/;

/** 向服务器要文件，并且不用浏览器自己留的旧副本：每次都确认有没有新版本（没变时服务器只回一句"没变"，很快） */
function fromNetwork(request) {
  // 打开页面这类请求不能原样改写，按地址重新发一次；遇到"转到另一个地址"时原样交还给浏览器去处理
  if (request.mode === "navigate") return fetch(request.url, { cache: "no-cache", credentials: "same-origin", redirect: "manual" });
  return fetch(request, { cache: "no-cache" });
}

/** 把某个版本的样式、脚本、配置存好（已经存过的跳过），并删掉其他版本留下的 */
async function storeBuild(build) {
  const cache = await caches.open(CACHE);
  await Promise.all(
    FILES.map(async (path) => {
      const url = `v/${build}/${path}`;
      if (await cache.match(url)) return;
      const response = await fetch(url).catch(() => null);
      if (response?.ok && /immutable/.test(response.headers.get("Cache-Control") || "")) await cache.put(url, response);
    })
  );
  for (const request of await cache.keys()) {
    const stamp = versionOf(new URL(request.url).pathname);
    if (stamp && stamp !== build) await cache.delete(request);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(PAGES.map((url) => new Request(url, { cache: "reload" })));
      // 首页里写着现在的版本号：有就按版本存；没有（本机预览等）就按不带版本号的地址存
      const html = await (await cache.match("./"))?.text();
      const build = /<meta name="build" content="([A-Za-z0-9]{1,40})"/.exec(html || "")?.[1];
      if (build && build !== "dev") await storeBuild(build);
      else await cache.addAll(FILES.map((url) => new Request(url, { cache: "reload" })));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const old = (await caches.keys()).filter((key) => key.startsWith("start-page-") && key !== CACHE);
      await Promise.all(old.map((key) => caches.delete(key)));
      await self.clients.claim();
      // 从旧版的"离线助手"升级上来时：已经打开着的页面可能还是用旧文件拼出来的，让它们重新加载一次
      if (old.length) {
        for (const client of await self.clients.matchAll({ type: "window" })) {
          client.navigate(client.url).catch(() => {});
        }
      }
    })()
  );
});

// 页面打开后会告诉这里"现在是哪一版"，这里把这一版的文件存好，断网时才打得开
self.addEventListener("message", (event) => {
  const data = event.data;
  if (data?.type === "store-build" && typeof data.build === "string" && BUILD_ID.test(data.build)) event.waitUntil(storeBuild(data.build));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  // 只处理普通读取请求；"不要缓存"的请求放行
  if (request.method !== "GET" || request.cache === "no-store") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (versionOf(url.pathname)) event.respondWith(cacheFirst(request));
  else if (isOwnFile(url.pathname)) event.respondWith(networkFirst(request));
});

/** 地址里的版本号（/v/版本号/assets/… 或 /v/版本号/config/…）；不是这种地址返回空 */
function versionOf(pathname) {
  if (!pathname.startsWith(BASE)) return "";
  return /^v\/([A-Za-z0-9]{1,40})\/(?:assets|config)\//.exec(pathname.slice(BASE.length))?.[1] || "";
}

// 起始页自己的文件：首页、/about/、assets/、config/ 和清单文件。别的路径属于其他应用，不碰。
function isOwnFile(pathname) {
  if (!pathname.startsWith(BASE)) return false;
  const rest = pathname.slice(BASE.length);
  return rest === "" || rest === "index.html" || rest === "manifest.webmanifest" || /^(assets|config|about)\//.test(rest) || rest === "about";
}

/** 带版本号的文件：内容不会变，存过就直接用 */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  // 只存服务器明确说"这个地址的内容永远不变"的回答。
  // （刚发布的那几秒里，服务器可能还没换成新版，那时给的内容不算数，不存。）
  if (response.ok && response.type === "basic" && /immutable/.test(response.headers.get("Cache-Control") || "")) cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fromNetwork(request);
    if (response.ok && response.type === "basic") cache.put(request, response.clone());
    return response;
  } catch (error) {
    // 起始页自己的文件不看问号后面的部分（比如图标地址后面的 ?v=版本号），断网时有存过的就用
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw error;
  }
}
