// 从 circle-flags（MIT）里挑出用到的圆形国旗，合成一张 SVG 雪碧图，生成 src/data/flags.ts。
// 一张图只需解析一次；每个国旗用 background-position 显示，比几十张独立 SVG 图片快得多。
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(path.join(root, 'src/lib/currencies.ts'), 'utf8');
const flags = [...new Set([...src.matchAll(/flag: '([a-z_]+)'/g)].map((m) => m[1]))].sort();
const dir = path.join(root, 'node_modules/circle-flags/flags');
const COLS = 8;
const ROWS = Math.ceil(flags.length / COLS);
const CELL = 512;

const parts = flags.map((f, i) => {
  let svg = readFileSync(path.join(dir, `${f}.svg`), 'utf8').trim();
  const inner = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  // 每个国旗里的 id（遮罩等）加前缀，避免合在一张图里互相冲突
  const p = `f${i}`;
  const body = inner
    .replace(/id="([^"]+)"/g, `id="${p}$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${p}$1)`)
    .replace(/href="#([^"]+)"/g, `href="#${p}$1"`);
  const x = (i % COLS) * CELL;
  const y = Math.floor(i / COLS) * CELL;
  return `<svg x="${x}" y="${y}" width="${CELL}" height="${CELL}" viewBox="0 0 512 512">${body}</svg>`;
});

const sprite = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${COLS * CELL}" height="${ROWS * CELL}" viewBox="0 0 ${COLS * CELL} ${ROWS * CELL}">${parts.join('')}</svg>`;
const uri = 'data:image/svg+xml,' + encodeURIComponent(sprite).replace(/%20/g, ' ').replace(/%3D/g, '=').replace(/%3A/g, ':').replace(/%2F/g, '/').replace(/%22/g, "'");
const version = JSON.parse(readFileSync(path.join(root, 'node_modules/circle-flags/package.json'), 'utf8')).version;

writeFileSync(
  path.join(root, 'src/data/flags.ts'),
  `// 自动生成（scripts/gen-flags.mjs），来自 circle-flags ${version}，MIT License © HatScripts\n` +
    `export const FLAG_COLS = ${COLS};\nexport const FLAG_ROWS = ${ROWS};\n` +
    `export const FLAG_INDEX: Record<string, number> = ${JSON.stringify(Object.fromEntries(flags.map((f, i) => [f, i])))};\n` +
    `export const FLAG_SPRITE = ${JSON.stringify(uri)};\n`,
);
console.log(`flags: ${flags.length}, sprite ${(uri.length / 1024).toFixed(1)} KB`);
