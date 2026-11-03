import fs from 'node:fs'
import path from 'node:path'
import { unzipSync } from 'fflate'
import { planImport, sanitizeFolderName, uniqueName } from '../core/pets/importPlan'

const MAX_BYTES = 300 * 1024 * 1024

/** Unpack a .zip pet pack into `userDir`. Returns the created folder name. */
export function importZip(zipFile: string, userDir: string): string {
  const stat = fs.statSync(zipFile)
  if (stat.size > MAX_BYTES) throw new Error('压缩包太大了（超过 300MB）')
  const entries = unzipSync(new Uint8Array(fs.readFileSync(zipFile)))
  const plan = planImport(Object.keys(entries), path.basename(zipFile))
  const total = plan.files.reduce((s, f) => s + entries[f.from].length, 0)
  if (total > MAX_BYTES) throw new Error('解压后太大了（超过 300MB）')
  const name = uniqueName(plan.name, (n) => fs.existsSync(path.join(userDir, n)))
  const root = path.join(userDir, name)
  for (const f of plan.files) {
    const out = path.resolve(root, f.to)
    if (!out.startsWith(path.resolve(root) + path.sep)) throw new Error(`不安全的路径：${f.from}`)
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, entries[f.from])
  }
  return name
}

/** Copy a pet pack folder into `userDir`. Returns the created folder name. */
export function importFolder(dir: string, userDir: string): string {
  const has = (f: string) => fs.existsSync(path.join(dir, f))
  if (!has('pet.json') && !has('manifest.json') && !has('spritesheet.webp') && !has('spritesheet.png')) {
    throw new Error('这个文件夹里没有 pet.json 或 manifest.json')
  }
  if (path.resolve(dir).startsWith(path.resolve(userDir) + path.sep)) throw new Error('它已经在形象包目录里了，点“重新扫描”即可')
  const name = uniqueName(sanitizeFolderName(path.basename(dir)), (n) => fs.existsSync(path.join(userDir, n)))
  fs.cpSync(dir, path.join(userDir, name), { recursive: true })
  return name
}
