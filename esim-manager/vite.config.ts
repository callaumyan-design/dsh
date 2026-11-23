/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 两种构建：
// - 默认：多文件，部署到任意 HTTPS 静态托管（GitHub Pages 等）
// - --mode single：输出单个 HTML（JS/CSS 内联），可以直接双击用 Chrome / Edge 打开
export default defineConfig(({ mode }) => ({
  // 相对路径，方便部署到任意 HTTPS 子路径（Web Bluetooth 需要安全上下文）
  base: './',
  plugins: [react(), tailwindcss(), ...(mode === 'single' ? [viteSingleFile()] : [])],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    rollupOptions: {
      output: {
        manualChunks: mode === 'single' ? undefined : (id) => {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
          if (id.includes('@radix-ui') || id.includes('@floating-ui')) return 'radix';
          if (id.includes('lucide-react')) return 'icons';
          return 'vendor';
        },
      },
    },
  },
  server: {
    // 只监听 localhost：Web Bluetooth 只在 https 或 localhost 这类安全上下文中可用
    host: 'localhost',
    port: 5173,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['src/test/setup.ts'],
  },
}));
