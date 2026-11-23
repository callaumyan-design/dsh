import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';

let cached: string | null = null;

/** 用 esbuild 把伪蓝牙入口打包成可注入的脚本。 */
export function fakeBluetoothScript(): string {
  if (cached) return cached;
  const result = buildSync({
    entryPoints: [fileURLToPath(new URL('./fakeBluetoothEntry.ts', import.meta.url))],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
    tsconfig: fileURLToPath(new URL('../../tsconfig.app.json', import.meta.url)),
  });
  cached = result.outputFiles[0]!.text;
  return cached;
}
