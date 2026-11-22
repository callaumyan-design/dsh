// Bundle the plugin into lib/: the entry plus lazily loaded tokenizer chunks.
// Only the host-shared DSH packages stay external (resolved from the running
// dsh installation as peers); everything else (js-tiktoken ranks, yaml,
// schemastery) is bundled so a tarball install needs no extra downloads.
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { rmSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
rmSync(join(root, 'lib'), { recursive: true, force: true })

await build({
  absWorkingDir: root,
  entryPoints: ['src/index.ts'],
  outdir: 'lib',
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: false,
  legalComments: 'linked',
  chunkNames: 'chunks/[name]-[hash]',
  external: ['@deepseek-ai/dsh-tools', '@deepseek-ai/cordis'],
  define: { __PLUGIN_VERSION__: JSON.stringify(pkg.version) },
  // Bundled CommonJS dependencies (yaml) call require() for Node built-ins.
  banner: { js: "import { createRequire as __fpCreateRequire } from 'node:module'; const require = __fpCreateRequire(import.meta.url);" },
  logLevel: 'warning',
})

// Type declarations (consumers rarely need them, but keep the package honest).
execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json', '--emitDeclarationOnly'], { cwd: root, stdio: 'inherit' })
writeFileSync(join(root, 'lib/index.d.ts'), "export * from './types/index.js'\n")
console.log(`built ${pkg.name}@${pkg.version} -> lib/`)
