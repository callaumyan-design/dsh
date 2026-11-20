import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// 部署在 GitHub Pages 的 /news/ 子目录，所有路径用相对路径。
// VITE_API_BASE：后端地址，如 https://xxx.azurewebsites.net/api
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: null,
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: '科技晨读',
        short_name: '科技晨读',
        description: '每天早上一份数码与科技要闻，AI 中文摘要',
        lang: 'zh-CN',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#f4f6f5',
        theme_color: '#f4f6f5',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png}'] },
    }),
  ],
});
