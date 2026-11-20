/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 在线版地址：单文件版本（双击打开 / Claude Artifact）的设置页里会给出这个链接
const LIVE_URL = 'https://huilv.callaum.com/';

// 两种构建：
// - 默认：PWA（可安装、离线可用），由 Cloudflare Worker 或任意静态托管提供
// - --mode single：输出单个 index.html，双击即可使用，也用于发布 Artifact
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    define: {
      __SINGLE_FILE__: JSON.stringify(single),
      __LIVE_URL__: JSON.stringify(LIVE_URL),
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
              name: '简汇汇率',
              short_name: '简汇',
              description: '极简的多币种汇率对比与换算',
              lang: 'zh-CN',
              start_url: './',
              scope: './',
              display: 'standalone',
              orientation: 'portrait',
              background_color: '#f3f4f6',
              theme_color: '#f3f4f6',
              icons: [
                { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
                { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
                { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
              ],
            },
            workbox: {
              globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
              navigateFallback: 'index.html',
              navigateFallbackDenylist: [/^\/api\//],
            },
          }),
    ],
    build: {
      outDir: single ? 'dist-single' : 'dist',
      emptyOutDir: true,
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'worker/**/*.test.ts'],
    },
  };
});
