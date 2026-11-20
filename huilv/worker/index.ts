// Cloudflare Worker：提供应用页面（文件在构建时嵌入脚本），并在 /api/rates 上聚合汇率（边缘缓存 1 小时）。
// 浏览器先请求同源的 /api/rates，失败时才直接请求公开接口，所以没有这个 Worker 也能用。
import { fetchRates } from '../src/lib/rates';
import { FILES, type StaticFile } from './files.gen';

interface Ctx {
  waitUntil: (p: Promise<unknown>) => void;
}

const TTL = 3600;

async function rates(req: Request, ctx: Ctx): Promise<Response> {
  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(new URL('/api/rates', req.url).href, { method: 'GET' });
  const hit = await cache.match(key);
  if (hit) return hit;

  try {
    // Workers 不支持 cache: 'no-cache'，这里换成 Cloudflare 自己的子请求缓存
    const fetcher = (u: string, init?: RequestInit) => fetch(u, { signal: init?.signal, cf: { cacheTtl: 900 } } as RequestInit);
    const data = await fetchRates({ preferPages: true, timeoutMs: 6000, fetcher });
    const res = new Response(JSON.stringify(data), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': `public, max-age=600, s-maxage=${TTL}`,
        'access-control-allow-origin': '*',
      },
    });
    ctx.waitUntil(cache.put(key, res.clone()));
    return res;
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e instanceof Error ? e.message : e) }), {
      status: 502,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' },
    });
  }
}

function serve(req: Request, file: StaticFile): Response {
  const headers = new Headers({
    'content-type': file.type,
    etag: file.etag,
    'cache-control': file.immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  if (req.headers.get('if-none-match') === file.etag) return new Response(null, { status: 304, headers });
  return new Response(req.method === 'HEAD' ? null : file.body, { headers });
}

export default {
  async fetch(req: Request, _env: unknown, ctx: Ctx): Promise<Response> {
    const url = new URL(req.url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method Not Allowed', { status: 405 });
    if (url.pathname === '/api/rates') return rates(req, ctx);

    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = FILES[path];
    if (file) return serve(req, file);
    // 其他页面路径都交给应用
    if ((req.headers.get('accept') ?? '').includes('text/html')) return serve(req, FILES['/index.html']);
    return new Response('Not Found', { status: 404 });
  },
};
