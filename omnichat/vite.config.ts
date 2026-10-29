import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

// Providers the browser may call directly ("browser direct" mode); everything else goes through /api/proxy.
const DIRECT_PROVIDERS = [
  'https://api.openai.com',
  'https://api.anthropic.com',
  'https://generativelanguage.googleapis.com',
  'https://api.deepseek.com',
  'https://dashscope.aliyuncs.com',
  'https://api.moonshot.cn',
  'https://open.bigmodel.cn',
  'https://ark.cn-beijing.volces.com',
  'https://qianfan.baidubce.com',
  'https://api.minimax.chat',
  'https://api.siliconflow.cn',
  'https://openrouter.ai',
  'https://api.x.ai',
  'https://api.mistral.ai',
  'https://api.groq.com',
  'https://api.together.xyz',
  'https://api.perplexity.ai',
  'https://models.inference.ai.azure.com',
  'https://opencode.ai',
  'https://*.openai.azure.com',
];

/**
 * Writes Cloudflare Workers Assets' _headers. The Worker only runs for /api/*, so Hono's secureHeaders never
 * reaches index.html; without this file the app shell ships with no CSP. The inline theme bootstrap is allowed
 * by its hash, computed from the built page so line endings or edits can't silently break it.
 */
function securityHeaders(): Plugin {
  return {
    name: 'omnichat-security-headers',
    apply: 'build',
    writeBundle(options) {
      const dir = options.dir ?? 'dist/client';
      const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
      const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
        (m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`,
      );
      const csp = [
        "default-src 'self'",
        `script-src 'self' ${hashes.join(' ')}`.trim(),
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "font-src 'self' data:",
        "media-src 'self' blob: data:",
        "worker-src 'self' blob:",
        "manifest-src 'self'",
        "frame-src 'self' blob: data:",
        `connect-src 'self' ${DIRECT_PROVIDERS.join(' ')}`,
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'self'",
      ].join('; ');
      fs.writeFileSync(
        path.join(dir, '_headers'),
        [
          '/*',
          `  Content-Security-Policy: ${csp}`,
          '  Referrer-Policy: no-referrer',
          '  X-Content-Type-Options: nosniff',
          '  X-Frame-Options: SAMEORIGIN',
          '  Cross-Origin-Opener-Policy: same-origin',
          '  Permissions-Policy: camera=(), microphone=(self), geolocation=(), payment=(), usb=()',
          '  Cache-Control: no-cache',
          '',
          '/assets/*',
          '  Cache-Control: public, max-age=31536000, immutable',
          '',
        ].join('\n'),
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), securityHeaders()],
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
