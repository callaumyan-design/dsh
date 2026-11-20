// 把 dist/ 里的文件嵌进 Worker 脚本（Data 模块），生成 worker/files.gen.ts。
// 这样部署时不需要单独上传静态资源。
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const out = path.join(root, 'worker/.files');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(dist).sort();
const imports = [];
const entries = [];
files.forEach((file, i) => {
  const rel = '/' + path.relative(dist, file).split(path.sep).join('/');
  const type = TYPES[path.extname(file)];
  if (!type) throw new Error(`未知的文件类型：${rel}`);
  copyFileSync(file, path.join(out, `f${i}.bin`));
  const etag = '"' + createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16) + '"';
  const immutable = rel.startsWith('/assets/');
  imports.push(`import f${i} from './.files/f${i}.bin';`);
  entries.push(`  ${JSON.stringify(rel)}: { body: f${i}, type: ${JSON.stringify(type)}, etag: ${JSON.stringify(etag)}, immutable: ${immutable} },`);
});

writeFileSync(
  path.join(root, 'worker/files.gen.ts'),
  `// 自动生成（scripts/worker-files.mjs），不要手动修改\n${imports.join('\n')}\n\nexport interface StaticFile { body: ArrayBuffer; type: string; etag: string; immutable: boolean }\n\nexport const FILES: Record<string, StaticFile> = {\n${entries.join('\n')}\n};\n`,
);
console.log(`worker files: ${files.length}`);
