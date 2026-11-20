#!/usr/bin/env node
// 生成站点根目录的文件：项目目录页 index.html、清理旧缓存的 sw.js、.nojekyll。
//   node pages/build-root.mjs <站点目录>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = process.argv[2];
if (!site) {
  console.error('用法：node pages/build-root.mjs <站点目录>');
  process.exit(1);
}
const projects = JSON.parse(fs.readFileSync(path.join(here, 'projects.json'), 'utf8'));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const live = projects.filter((p) => fs.existsSync(path.join(site, p.path, 'index.html')));

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>我的小工具</title>
<script>
  // 四象限以前就放在这个根目录。已经“安装到桌面”的旧版从这里启动，直接带去它的新地址。
  if (window.matchMedia && matchMedia('(display-mode: standalone)').matches) location.replace('./quadrant/');
</script>
<style>
  :root { --bg: #f6f7f9; --fg: #1a1d24; --muted: #5f6673; --line: #e1e4ea; --accent: #2d5bd7; color-scheme: light; }
  @media (prefers-color-scheme: dark) { :root { --bg: #111318; --fg: #e8eaef; --muted: #9aa1ad; --line: #2a2e37; --accent: #8fa8ff; color-scheme: dark; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.7 system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
  main { max-width: 40rem; margin: 0 auto; padding-block: 3rem; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
  h1 { font-size: 1.5rem; margin: 0 0 1.5rem; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { border-top: 1px solid var(--line); }
  li:last-child { border-bottom: 1px solid var(--line); }
  a { display: block; padding: 1rem 0; color: inherit; text-decoration: none; }
  a:hover strong, a:focus-visible strong { color: var(--accent); }
  a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  strong { font-size: 1.1rem; }
  span { display: block; color: var(--muted); font-size: 0.9rem; }
</style>
</head>
<body>
<main>
  <h1>我的小工具</h1>
  <ul>
${live.map((p) => `    <li><a href="./${esc(p.path)}/"><strong>${esc(p.title)}</strong><span>${esc(p.description)}</span></a></li>`).join('\n')}
  </ul>
</main>
</body>
</html>
`;

// 四象限以前部署在根目录，它的离线缓存（Service Worker）管着整个站点，会挡住其他项目。
// 浏览器下次检查更新时会拿到这个文件：它删掉根目录那份旧缓存，然后注销自己。
// 新的四象限在 /quadrant/ 下注册自己的 Service Worker，只管 /quadrant/，和这里互不影响。
const sw = `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const scope = self.registration.scope;
    for (const key of await caches.keys()) {
      if (key.endsWith(scope)) await caches.delete(key);
    }
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
  })());
});
`;

fs.mkdirSync(site, { recursive: true });
fs.writeFileSync(path.join(site, 'index.html'), html);
fs.writeFileSync(path.join(site, 'sw.js'), sw);
fs.writeFileSync(path.join(site, '.nojekyll'), '');
console.log(`✓ 首页已更新（${live.length} 个项目）`);
