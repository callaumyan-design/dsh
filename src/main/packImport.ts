import fs from 'node:fs'
import path from 'node:path'
import { unzipSync } from 'fflate'
import { fitSize, imageSize } from '../core/pets/imageSize'
import { planImport, sanitizeFolderName, uniqueName } from '../core/pets/importPlan'
import { findModel3 } from './model3'

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
  if (!has('pet.json') && !has('manifest.json') && !has('spritesheet.webp') && !has('spritesheet.png') && !findModel3(dir)) {
    throw new Error('这个文件夹里没有 pet.json、manifest.json 或 Live2D 模型')
  }
  if (path.resolve(dir).startsWith(path.resolve(userDir) + path.sep)) throw new Error('它已经在形象包目录里了，点“重新扫描”即可')
  const name = uniqueName(sanitizeFolderName(path.basename(dir)), (n) => fs.existsSync(path.join(userDir, n)))
  fs.cpSync(dir, path.join(userDir, name), { recursive: true })
  return name
}

/** Turn a single picture into a procedurally animated pet pack. Returns the folder name. */
export function createFromImage(imageFile: string, userDir: string, displayName?: string): string {
  return createFromImageData(fs.readFileSync(imageFile), displayName || path.basename(imageFile, path.extname(imageFile)), userDir, displayName)
}

export function createFromImageData(data: Uint8Array, baseName: string, userDir: string, displayName?: string): string {
  if (data.length > 30 * 1024 * 1024) throw new Error('图片太大了（超过 30MB）')
  const size = imageSize(new Uint8Array(data))
  if (!size) throw new Error('不支持的图片格式，请用 PNG / GIF / WebP / JPEG')
  const ext = size.type === 'jpeg' ? 'jpg' : size.type
  const base = sanitizeFolderName(baseName)
  const name = uniqueName(base, (n) => fs.existsSync(path.join(userDir, n)))
  const root = path.join(userDir, name)
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(path.join(root, `image.${ext}`), data)
  const manifest = {
    format: 'soulpet-frames',
    name: displayName || base,
    author: '我',
    size: fitSize(size),
    animate: true,
    states: { idle: `image.${ext}` }
  }
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2))
  return name
}
