// Service Worker：让起始页可以"添加到主屏幕"，并在断网时也能打开。
// 策略：本站文件"网络优先"——有网就拿最新的，没网才用上次存下的。
// 站外请求（搜索引擎、AI 接口、状态检测）完全不经手。
const CACHE = "start-page-v1";

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
  "assets/js/engines.js",
  "assets/js/search.js",
  "assets/js/nav.js",
  "assets/js/nav-model.js",
  "assets/js/nav-edit.js",
  "assets/js/status.js",
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
  // 只处理本站的普通读取请求；"不要缓存"的请求（状态检测）也放行
  if (request.method !== "GET" || request.cache === "no-store") return;
  if (new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(request));
});

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
