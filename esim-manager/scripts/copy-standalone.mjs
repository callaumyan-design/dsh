// 把单文件构建结果复制到 standalone/，供直接下载、双击打开。
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = `${root}dist-single/index.html`;
const dest = `${root}standalone/9eSIM-Web-Manager.html`;
mkdirSync(`${root}standalone`, { recursive: true });
copyFileSync(src, dest);
console.log(`standalone/9eSIM-Web-Manager.html  ${(statSync(dest).size / 1024).toFixed(0)} KB`);
