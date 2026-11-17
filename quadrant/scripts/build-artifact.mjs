// 把单文件构建（dist-single/index.html）转换成可发布为 Claude Artifact 的页面片段：
// 去掉 <!doctype>/<html>/<head>/<body> 外壳，保留 <title>、<style>、根节点和内联脚本。
import { readFileSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(root, 'dist-single/index.html'), 'utf8');

const title = html.match(/<title>[\s\S]*?<\/title>/)?.[0] ?? '<title>四象限任务计划</title>';
const styles = [...html.matchAll(/<style[^>]*>[\s\S]*?<\/style>/g)].map((m) => m[0]);
const scripts = [...html.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/g)].map((m) => m[0]);
if (!styles.length || !scripts.length) throw new Error('单文件构建中没有找到内联样式或脚本');

const out = [title, ...styles, '<div id="root"></div>', ...scripts].join('\n');
mkdirSync(path.join(root, 'dist-artifact'), { recursive: true });
writeFileSync(path.join(root, 'dist-artifact/quadrant-planner.html'), out);

// 同时生成一个可双击打开的独立版本（图标内联）
const favicon = readFileSync(path.join(root, 'public/favicon.svg'), 'utf8');
const standalone = html
  .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(favicon)}" />`)
  .replace(/<link rel="apple-touch-icon"[^>]*>\s*/, '');
mkdirSync(path.join(root, 'standalone'), { recursive: true });
writeFileSync(path.join(root, 'standalone/四象限任务计划.html'), standalone);

console.log(`artifact: ${(out.length / 1024).toFixed(1)} KB, standalone: ${(standalone.length / 1024).toFixed(1)} KB`);
