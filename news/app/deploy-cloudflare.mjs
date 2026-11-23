#!/usr/bin/env node
// 把科技晨读 App 发布到 Cloudflare Worker，并绑定 news.callaum.com。
//
// 做法和起始页一样：把 dist/ 里的文件打包进一个 Worker 一起上传，不需要额外的存储。
//
// 用法（在 news/app 目录）：
//   npm run build && node deploy-cloudflare.mjs            打包并发布
//   node deploy-cloudflare.mjs --dry-run                   只打包到 .deploy/，不上传
//
// 需要 Cloudflare API 令牌（权限：Workers Scripts 编辑、Workers Routes 编辑），放在环境变量 CLOUDFLARE_API_TOKEN。
// 在 Claude 的云端会话里，令牌已保存在环境的网络凭证中时不用设。
// 可选：CLOUDFLARE_ACCOUNT_ID、WORKER_NAME（默认 news）、NEWS_HOSTNAME（默认 news.callaum.com）。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, '.deploy');
const NAME = process.env.WORKER_NAME || 'news';
const HOSTNAME = process.env.NEWS_HOSTNAME || 'news.callaum.com';
const DRY_RUN = process.argv.includes('--dry-run');
const API = 'https://api.cloudflare.com/client/v4';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('dist/ 里没有 index.html，先运行 npm run build');
  process.exit(1);
}
if (!fs.readFileSync(path.join(ROOT, '.env.production'), 'utf8').match(/^VITE_API_BASE=https:\/\//m)) {
  console.error('.env.production 里没有配置 VITE_API_BASE');
  process.exit(1);
}

const list = (dir, rel = '') =>
  fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((d) => {
    const r = path.posix.join(rel, d.name);
    return d.isDirectory() ? list(dir, r) : [r];
  });

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const sha = (b) => createHash('sha256').update(b).digest('hex');
const files = list(DIST).sort();
const imports = [];
const table = [];
const parts = [];
let total = 0;
files.forEach((rel, i) => {
  const bytes = fs.readFileSync(path.join(DIST, rel));
  const mod = `f${i}.bin`;
  fs.writeFileSync(path.join(OUT, mod), bytes);
  imports.push(`import f${i} from "./${mod}";`);
  table.push(`  [${JSON.stringify('/' + rel)}, { body: f${i}, type: ${JSON.stringify(TYPES[path.extname(rel)] || 'application/octet-stream')}, etag: ${JSON.stringify(`"${sha(bytes).slice(0, 20)}"`)} }],`);
  parts.push(mod);
  total += bytes.length;
});

fs.writeFileSync(
  path.join(OUT, 'worker.js'),
  `// 由 news/app/deploy-cloudflare.mjs 生成，不要手改。
${imports.join('\n')}

const FILES = new Map([
${table.join('\n')}
]);

const NOT_FOUND = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>找不到这个页面</title><p style="font:16px system-ui;text-align:center;margin-top:20vh">找不到这个页面。<a href="/">回到科技晨读</a></p>';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    let p;
    try { p = decodeURIComponent(url.pathname); } catch { p = ''; }
    const file = FILES.get(p) ?? (p.endsWith('/') ? FILES.get(p + 'index.html') : undefined);
    if (!file) return new Response(request.method === 'HEAD' ? null : NOT_FOUND, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    // assets/ 里的文件名带内容指纹，可以长期缓存；页面、sw.js、manifest 每次都确认有没有新版本
    const immutable = p.startsWith('/assets/');
    const headers = {
      'Content-Type': file.type,
      ETag: file.etag,
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    };
    if (request.headers.get('If-None-Match') === file.etag) return new Response(null, { status: 304, headers });
    return new Response(request.method === 'HEAD' ? null : file.body, { headers });
  },
};
`,
);
fs.writeFileSync(path.join(OUT, 'metadata.json'), JSON.stringify({ main_module: 'worker.js', compatibility_date: '2026-01-01' }));
console.log(`打包完成：${files.length} 个文件，共 ${(total / 1024).toFixed(0)} KB → .deploy/`);
if (DRY_RUN) process.exit(0);

function cf(method, endpoint, extra = []) {
  const args = ['-sS', '-m', '120', '-X', method, API + endpoint];
  if (process.env.CLOUDFLARE_API_TOKEN) args.push('-H', `Authorization: Bearer ${process.env.CLOUDFLARE_API_TOKEN}`);
  const text = execFileSync('curl', [...args, ...extra], { cwd: OUT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const data = JSON.parse(text);
  if (!data.success) {
    console.error(`请求失败：${method} ${endpoint}\n${text.slice(0, 600)}`);
    process.exit(1);
  }
  return data.result;
}

let account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!account) {
  const accounts = cf('GET', '/accounts?per_page=50');
  if (accounts.length !== 1) {
    console.error(`这个令牌能看到 ${accounts.length} 个账户，请用 CLOUDFLARE_ACCOUNT_ID 指定`);
    process.exit(1);
  }
  account = accounts[0].id;
}

const form = ['-F', 'metadata=@metadata.json;type=application/json', '-F', 'worker.js=@worker.js;type=application/javascript+module'];
for (const p of parts) form.push('-F', `${p}=@${p};type=application/octet-stream`);
cf('PUT', `/accounts/${account}/workers/scripts/${NAME}`, form);
console.log(`已上传 Worker：${NAME}`);

// 绑定自己的域名（已经绑过就保持不变）
const zone = HOSTNAME.split('.').slice(-2).join('.');
const [z] = cf('GET', `/zones?name=${encodeURIComponent(zone)}`);
if (!z) {
  console.error(`Cloudflare 账户里没有 ${zone} 这个域名`);
  process.exit(1);
}
cf('PUT', `/accounts/${account}/workers/domains`, ['-H', 'Content-Type: application/json', '--data', JSON.stringify({ environment: 'production', hostname: HOSTNAME, service: NAME, zone_id: z.id })]);
console.log(`发布完成：https://${HOSTNAME}/`);
