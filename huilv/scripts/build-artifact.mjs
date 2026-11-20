// 把单文件构建（dist-single/index.html）转换成：
// 1. dist-artifact/huilv.html：可发布为 Claude Artifact 的页面片段（去掉 doctype/html/head/body 外壳）
// 2. standalone/简汇汇率.html：可以直接双击打开的独立版本
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(root, 'dist-single/index.html'), 'utf8');

const title = html.match(/<title>[\s\S]*?<\/title>/)?.[0] ?? '<title>简汇汇率</title>';
const styles = [...html.matchAll(/<style[^>]*>[\s\S]*?<\/style>/g)].map((m) => m[0]);
const scripts = [...html.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/g)].map((m) => m[0]);
if (!styles.length || !scripts.length) throw new Error('单文件构建中没有找到内联样式或脚本');

// Artifact 的外壳已经按安全区域给 :root 加了上下内边距，这里不再重复
const artifactFix = '<style>:root{--safe-top:0px;--safe-bottom:0px}</style>';
const out = [
  title,
  '<meta name="claude:viewport-fit-sides" content="cover">',
  '<meta name="theme-color" content="#fbfbfc">',
  ...styles,
  artifactFix,
  '<div id="root"></div>',
  ...scripts,
].join('\n');
mkdirSync(path.join(root, 'dist-artifact'), { recursive: true });
writeFileSync(path.join(root, 'dist-artifact/huilv.html'), out);

const favicon = readFileSync(path.join(root, 'public/favicon.svg'), 'utf8');
const standalone = html
  .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(favicon)}" />`)
  .replace(/<link rel="apple-touch-icon"[^>]*>\s*/, '');
mkdirSync(path.join(root, 'standalone'), { recursive: true });
writeFileSync(path.join(root, 'standalone/简汇汇率.html'), standalone);

console.log(`artifact: ${(out.length / 1024).toFixed(1)} KB, standalone: ${(standalone.length / 1024).toFixed(1)} KB`);
