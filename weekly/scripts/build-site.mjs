#!/usr/bin/env node
// 生成静态网站到 dist/（也可用 --out 指定）。
//   node scripts/build-site.mjs            用 data/issues/ 里的真实期刊
//   node scripts/build-site.mjs --sample   用 test/fixtures/sample-issue.json 预览样式
// SITE_URL 环境变量是网站的绝对地址（以 / 结尾），用于 RSS 里的链接。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadIssues } from '../lib/issues.mjs';
import { renderIndex, renderIssuePage, renderFeed } from '../lib/render.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const out = path.resolve(outIdx >= 0 ? argv[outIdx + 1] : path.join(root, 'dist'));

const issues = argv.includes('--sample')
  ? [JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/sample-issue.json'), 'utf8'))]
  : loadIssues(path.join(root, 'data/issues'));

let siteUrl = process.env.SITE_URL || 'http://localhost:4173/';
if (!siteUrl.endsWith('/')) siteUrl += '/';
if (!process.env.SITE_URL) console.warn(`⚠ 没有设置 SITE_URL，RSS 链接暂用 ${siteUrl}`);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'issues'), { recursive: true });
fs.copyFileSync(path.join(root, 'site/style.css'), path.join(out, 'style.css'));
fs.writeFileSync(path.join(out, 'index.html'), renderIndex(issues));
for (const issue of issues) {
  fs.writeFileSync(path.join(out, 'issues', `${issue.id}.html`), renderIssuePage(issue, issues));
}
fs.writeFileSync(path.join(out, 'feed.xml'), renderFeed(issues, siteUrl));
console.log(`✓ 已生成 ${issues.length} 期到 ${path.relative(process.cwd(), out) || '.'}`);
