/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 两种构建：
// - 默认：PWA（可安装、离线可用），部署到任意静态托管（GitHub Pages 等）
// - --mode single：输出单个 index.html，双击即可离线使用，也用于预览发布
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    define: {
      __SINGLE_FILE__: JSON.stringify(single),
    },
    plugins: [
      react(),
      single
        ? viteSingleFile()
        : VitePWA({
            registerType: 'autoUpdate',
            injectRegister: null,
            includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
            manifest: {
              name: '四象限 · 任务计划',
              short_name: '四象限',
              description: '按重要程度与紧急程度管理任务的四象限计划工具',
              lang: 'zh-CN',
              start_url: './',
              scope: './',
              display: 'standalone',
              orientation: 'any',
              background_color: '#f5f6f8',
              theme_color: '#f5f6f8',
              icons: [
                { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
                { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
                { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
              ],
            },
            workbox: {
              globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
              navigateFallback: 'index.html',
              // 同一站点下的 /weekly/ 是热榜周刊，不要被四象限的离线回退页接管
              navigateFallbackDenylist: [/\/weekly(\/|$)/],
              runtimeCaching: [
                {
                  urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
                  handler: 'StaleWhileRevalidate',
                  options: { cacheName: 'google-fonts', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 } },
                },
              ],
            },
          }),
    ],
    build: {
      outDir: single ? 'dist-single' : 'dist',
      emptyOutDir: true,
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  };
});
