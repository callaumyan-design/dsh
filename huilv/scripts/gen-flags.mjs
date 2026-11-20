// 从 circle-flags（MIT）里挑出用到的圆形国旗，生成 src/data/flags.ts（data URI，避免 SVG id 冲突）
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(path.join(root, 'src/lib/currencies.ts'), 'utf8');
const flags = [...new Set([...src.matchAll(/flag: '([a-z_]+)'/g)].map((m) => m[1]))].sort();
const dir = path.join(root, 'node_modules/circle-flags/flags');
const lines = flags.map((f) => {
  const svg = readFileSync(path.join(dir, `${f}.svg`), 'utf8').trim().replace(/ width="512" height="512"/, '');
  const uri = 'data:image/svg+xml,' + encodeURIComponent(svg).replace(/%20/g, ' ').replace(/%3D/g, '=').replace(/%3A/g, ':').replace(/%2F/g, '/').replace(/%22/g, "'");
  return `  ${f}: ${JSON.stringify(uri.replace(/'/g, '%27').replace(/%27/g, "'"))},`;
});
writeFileSync(
  path.join(root, 'src/data/flags.ts'),
  `// 自动生成（scripts/gen-flags.mjs），来自 circle-flags ${JSON.parse(readFileSync(path.join(root, 'node_modules/circle-flags/package.json'), 'utf8')).version}，MIT License © HatScripts\nexport const FLAGS: Record<string, string> = {\n${lines.join('\n')}\n};\n`,
);
console.log(`flags: ${flags.length}`);
