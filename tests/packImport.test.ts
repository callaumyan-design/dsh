import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import { importFolder, importZip } from '../src/main/packImport'

const tmp: string[] = []
function tempDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'soulpet-'))
  tmp.push(d)
  return d
}
afterEach(() => {
  for (const d of tmp.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

describe('importZip / importFolder', () => {
  it('extracts a zipped pack with a top folder into a unique directory', () => {
    const work = tempDir()
    const pets = path.join(work, 'pets')
    fs.mkdirSync(path.join(pets, 'fox'), { recursive: true }) // name already taken
    const zip = zipSync({
      'fox/manifest.json': strToU8(JSON.stringify({ name: '狐狸', states: { idle: 'idle.gif' } })),
      'fox/idle.gif': new Uint8Array([71, 73, 70]),
      '__MACOSX/fox/._idle.gif': new Uint8Array([0])
    })
    const zf = path.join(work, 'fox.zip')
    fs.writeFileSync(zf, zip)
    const name = importZip(zf, pets)
    expect(name).toBe('fox-2')
    expect(fs.readdirSync(path.join(pets, name)).sort()).toEqual(['idle.gif', 'manifest.json'])
  })

  it('refuses archives with traversal paths', () => {
    const work = tempDir()
    const zf = path.join(work, 'evil.zip')
    fs.writeFileSync(zf, zipSync({ 'pet.json': strToU8('{}'), '../../evil.txt': strToU8('x') }))
    expect(() => importZip(zf, path.join(work, 'pets'))).toThrow(/不安全/)
    expect(fs.existsSync(path.join(work, 'evil.txt'))).toBe(false)
  })

  it('copies a folder pack', () => {
    const work = tempDir()
    const src = path.join(work, 'My Pet')
    fs.mkdirSync(src)
    fs.writeFileSync(path.join(src, 'pet.json'), '{}')
    fs.writeFileSync(path.join(src, 'spritesheet.png'), 'png')
    const pets = path.join(work, 'pets')
    fs.mkdirSync(pets)
    expect(importFolder(src, pets)).toBe('My Pet')
    expect(fs.existsSync(path.join(pets, 'My Pet', 'spritesheet.png'))).toBe(true)
    fs.mkdirSync(path.join(work, 'empty'))
    expect(() => importFolder(path.join(work, 'empty'), pets)).toThrow(/没有 pet.json/)
  })
})
