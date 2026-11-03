import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { fitSize, imageSize } from '../src/core/pets/imageSize'
import { createFromImage } from '../src/main/packImport'

function u8(...parts: Array<number[] | string>): Uint8Array {
  const out: number[] = []
  for (const p of parts) typeof p === 'string' ? out.push(...[...p].map((c) => c.charCodeAt(0))) : out.push(...p)
  return new Uint8Array(out)
}
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const le16 = (n: number) => [n & 255, (n >> 8) & 255]
const be16 = (n: number) => [(n >> 8) & 255, n & 255]

describe('imageSize', () => {
  it('reads PNG, GIF, WebP (VP8X) and JPEG headers', () => {
    expect(imageSize(u8([0x89], 'PNG', [13, 10, 26, 10], be32(13), 'IHDR', be32(300), be32(200), [8, 6, 0, 0, 0]))).toEqual({ width: 300, height: 200, type: 'png' })
    expect(imageSize(u8('GIF89a', le16(64), le16(48), [0, 0, 0]))).toEqual({ width: 64, height: 48, type: 'gif' })
    const w = 640 - 1
    const h = 480 - 1
    expect(imageSize(u8('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8X', [10, 0, 0, 0], [0, 0, 0, 0], [w & 255, (w >> 8) & 255, 0], [h & 255, (h >> 8) & 255, 0]))).toEqual({ width: 640, height: 480, type: 'webp' })
    expect(imageSize(u8([0xff, 0xd8], [0xff, 0xe0], be16(4), [0, 0], [0xff, 0xc0], be16(17), [8], be16(120), be16(160), [3, 0, 0, 0, 0, 0, 0, 0, 0]))).toEqual({ width: 160, height: 120, type: 'jpeg' })
    expect(imageSize(u8('nope'))).toBeNull()
  })

  it('fits into a pet box keeping aspect ratio', () => {
    expect(fitSize({ width: 1000, height: 500 })).toEqual([190, 95])
    expect(fitSize({ width: 100, height: 400 })).toEqual([80, 190])
  })
})

describe('createFromImage', () => {
  it('creates a procedural frames pack from a PNG', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soulpet-img-'))
    try {
      const name = createFromImage(path.resolve('resources/icons/icon.png'), dir, '我的果冻')
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, name, 'manifest.json'), 'utf8'))
      expect(manifest).toMatchObject({ name: '我的果冻', animate: true, size: [190, 190], states: { idle: 'image.png' } })
      expect(fs.existsSync(path.join(dir, name, 'image.png'))).toBe(true)
      fs.writeFileSync(path.join(dir, 'bad.txt'), 'hello')
      expect(() => createFromImage(path.join(dir, 'bad.txt'), dir)).toThrow(/不支持/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
