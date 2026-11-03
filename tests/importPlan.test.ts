import { describe, expect, it } from 'vitest'
import { planImport, sanitizeFolderName, uniqueName } from '../src/core/pets/importPlan'

describe('pet pack import plan', () => {
  it('accepts a codex pack at the root', () => {
    const p = planImport(['pet.json', 'spritesheet.webp', '__MACOSX/._pet.json'], 'My Cat.zip')
    expect(p).toEqual({ name: 'My Cat', kind: 'codex', files: [{ from: 'pet.json', to: 'pet.json' }, { from: 'spritesheet.webp', to: 'spritesheet.webp' }] })
  })

  it('strips a single top-level folder', () => {
    const p = planImport(['fox/', 'fox/manifest.json', 'fox/idle.gif', 'fox/walk/1.png'], 'download.zip')
    expect(p.name).toBe('fox')
    expect(p.kind).toBe('frames')
    expect(p.files.map((f) => f.to)).toEqual(['manifest.json', 'idle.gif', 'walk/1.png'])
  })

  it('rejects traversal, absolute paths and non-packs', () => {
    expect(() => planImport(['pet.json', '../evil.dll'], 'x.zip')).toThrow(/不安全/)
    expect(() => planImport(['C:/Windows/x', 'pet.json'], 'x.zip')).toThrow(/不安全/)
    expect(() => planImport(['readme.txt'], 'x.zip')).toThrow(/不是形象包/)
    expect(() => planImport([], 'x.zip')).toThrow(/空/)
  })

  it('sanitizes and de-duplicates folder names', () => {
    expect(sanitizeFolderName('a<b>:c.zip')).toBe('a_b__c')
    expect(sanitizeFolderName('...')).toBe('pet')
    const taken = new Set(['cat', 'cat-2'])
    expect(uniqueName('cat', (n) => taken.has(n))).toBe('cat-3')
    expect(uniqueName('dog', (n) => taken.has(n))).toBe('dog')
  })
})
