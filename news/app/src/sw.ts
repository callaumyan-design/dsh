/// <reference lib="webworker" />
// Service Worker：离线缓存 + 推送通知
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// 新闻数据：优先联网，断网时用最近一次的缓存
registerRoute(
  ({ url, request }) => request.method === 'GET' && /\/api\/v1\/editions(\/|$)/.test(url.pathname),
  new NetworkFirst({ cacheName: 'editions', networkTimeoutSeconds: 6, plugins: [new ExpirationPlugin({ maxEntries: 40, maxAgeSeconds: 30 * 86400 })] }),
);
// 新闻配图
registerRoute(
  ({ request }) => request.destination === 'image',
  new StaleWhileRevalidate({ cacheName: 'images', plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 7 * 86400 })] }),
);

self.addEventListener('push', (event) => {
  let data: { title?: string; body?: string; tag?: string; url?: string } = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || '科技晨读', {
      body: data.body || '今天的科技新闻已更新',
      tag: data.tag,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      data: { url: data.url || './' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows.find((w) => w.url.startsWith(self.registration.scope));
      if (existing) {
        await existing.navigate(target).catch(() => {});
        return existing.focus();
      }
      return self.clients.openWindow(target);
    })(),
  );
});
