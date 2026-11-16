// Service Worker：让起始页可以"添加到主屏幕"，并在断网时也能打开。
// 策略：起始页自己的文件"网络优先"——有网就拿最新的，没网才用上次存下的。
// 其他一律不经手：站外请求（搜索引擎、壁纸、AI 接口），
// 以及同一个域名下别的应用（如 /duo/、/uq/、/yanlu/）的页面和接口。
const CACHE = "start-page-v3";

// 首次安装时预先存好的核心文件
const CORE = [
  "./",
  "about/",
  "manifest.webmanifest",
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
  "assets/js/ai/auth.js",
  "assets/js/ai/client.js",
  "assets/js/ai/markdown.js",
  "assets/js/ai/panel.js",
  "assets/icons/favicon.svg",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/apps/duo.svg",
  "assets/icons/apps/catgpt.svg",
  "assets/icons/apps/uq.svg",
  "assets/icons/apps/yanlu.svg",
  "assets/icons/apps/wifidrop.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("start-page-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  // 只处理普通读取请求；"不要缓存"的请求放行
  if (request.method !== "GET" || request.cache === "no-store") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !isOwnFile(url.pathname)) return;
  event.respondWith(networkFirst(request));
});

// 起始页自己的文件：首页、/about/、assets/、config/ 和清单文件。别的路径属于其他应用，不碰。
const BASE = new URL("./", self.location).pathname; // 起始页所在的目录，如 "/" 或 "/dsh/"
function isOwnFile(pathname) {
  if (!pathname.startsWith(BASE)) return false;
  const rest = pathname.slice(BASE.length);
  return rest === "" || rest === "index.html" || rest === "manifest.webmanifest" || /^(assets|config|about)\//.test(rest) || rest === "about";
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: request.mode === "navigate" });
    if (cached) return cached;
    throw error;
  }
}
