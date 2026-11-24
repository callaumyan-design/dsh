import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

// Identifies this build: the server reports the build it serves, and open pages running an older one reload.
const BUILD_ID = process.env.BUILD_ID || Date.now().toString(36);

export default defineConfig({
  define: { __APP_BUILD__: JSON.stringify(BUILD_ID) },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'catgpt-build-id',
      transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'catgpt-build', content: BUILD_ID }, injectTo: 'head' }],
    },
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false },
    },
  },
});
