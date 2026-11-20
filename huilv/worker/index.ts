// Cloudflare Worker：提供应用页面（文件在构建时嵌入脚本），并在 /api/rates 上聚合汇率（边缘缓存 1 小时）。
// 浏览器先请求同源的 /api/rates，失败时才直接请求公开接口，所以没有这个 Worker 也能用。
import { fetchRates } from '../src/lib/rates';
import { fetchHistory, isPair, isRange } from '../src/lib/history';
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
    const data = await fetchRates({ preferPages: true, timeoutMs: 6000, fetcher: edgeFetch(900) });
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

const json = (data: unknown, status = 200, cacheSeconds = 0) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cacheSeconds ? `public, max-age=${Math.min(cacheSeconds, 600)}, s-maxage=${cacheSeconds}` : 'no-store',
      'access-control-allow-origin': '*',
    },
  });

// Workers 不支持 cache: 'no-cache'，子请求交给 Cloudflare 缓存一段时间
const edgeFetch = (ttl: number) => (u: string, init?: RequestInit) =>
  fetch(u, { signal: init?.signal, headers: init?.headers, cf: { cacheTtl: ttl } } as RequestInit);

async function history(req: Request, ctx: Ctx): Promise<Response> {
  const url = new URL(req.url);
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';
  const range = url.searchParams.get('range') ?? '3m';
  if (!isPair(from, to) || !isRange(range)) return json({ error: '参数不正确' }, 400);

  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(`${url.origin}/api/history?from=${from}&to=${to}&range=${range}`, { method: 'GET' });
  const hit = await cache.match(key);
  if (hit) return hit;

  // 日K 盘中会变，缓存 15 分钟；周K、月K 缓存 6 小时
  const ttl = range === '1m' || range === '3m' ? 900 : 21600;
  try {
    const data = await fetchHistory(from, to, range, { yahoo: true, fetcher: edgeFetch(ttl) });
    const res = json(data, 200, ttl);
    ctx.waitUntil(cache.put(key, res.clone()));
    return res;
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 502);
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
    if (url.pathname === '/api/history') return history(req, ctx);

    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = FILES[path];
    if (file) return serve(req, file);
    // 其他页面路径都交给应用
    if ((req.headers.get('accept') ?? '').includes('text/html')) return serve(req, FILES['/index.html']);
    return new Response('Not Found', { status: 404 });
  },
};
