import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { planImport } from '../src/core/pets/importPlan'
import { live2dMotionFor, normalizeLive2DPack, type PackIO } from '../src/core/pets/pack'
import { findModel3 } from '../src/main/model3'

const io = (files: string[]): PackIO => ({ url: (r) => `asset://x/${r}`, exists: (r) => files.includes(r), list: () => [] })

describe('live2d packs', () => {
  it('normalizes a manifest and never exposes a bundled core', () => {
    const p = normalizeLive2DPack({ format: 'live2d', name: '春', model: 'runtime/haru.model3.json', size: [260, 380], zoom: 1.2 }, 'haru', io(['runtime/haru.model3.json', 'live2dcubismcore.min.js']), 'user')
    expect(p.kind).toBe('live2d')
    expect(p.width).toBe(260)
    expect(p.live2d).toEqual({ model: 'asset://x/runtime/haru.model3.json', zoom: 1.2, offsetY: 0, motions: {}, expressions: {} })
    expect(p.warnings).toEqual([])
    expect(normalizeLive2DPack({ format: 'live2d', model: 'a.moc' }, 'x', io([]), 'user').warnings.length).toBe(2)
  })

  it('survives broken manifests', () => {
    const p = normalizeLive2DPack({ format: 'live2d', name: 'x', size: ['260', 380], zoom: 'big', motions: 'nope' } as never, 'x', io([]), 'user')
    expect(p.warnings[0]).toMatch(/未填写 model/)
    expect([p.width, p.height]).toEqual([240, 320].map((v, i) => (i === 1 ? 380 : v)))
    expect(p.live2d).toMatchObject({ model: '', zoom: 1, motions: {} })
  })

  it('maps states to motion groups', () => {
    const groups = ['Idle', 'TapBody', 'Talk']
    expect(live2dMotionFor('idle', { motions: {} }, groups)).toEqual({ group: 'Idle' })
    expect(live2dMotionFor('talk', { motions: {} }, groups)).toEqual({ group: 'Talk' })
    expect(live2dMotionFor('happy', { motions: {} }, groups)).toEqual({ group: 'TapBody' })
    expect(live2dMotionFor('think', { motions: {} }, groups)).toEqual({ group: 'Idle' })
    expect(live2dMotionFor('happy', { motions: { happy: 'TapBody:2' } }, groups)).toEqual({ group: 'TapBody', index: 2 })
    expect(live2dMotionFor('happy', { motions: { happy: 'Nope' } }, groups)).toEqual({ group: 'TapBody' }) // bad mapping falls back
    expect(live2dMotionFor('sleep', { motions: { sleep: 'Idle:two' } }, groups)).toEqual({ group: 'Idle' })
    expect(live2dMotionFor('wave', { motions: { wave: 'Tap:Body:1' } }, ['Tap:Body'])).toEqual({ group: 'Tap:Body', index: 1 })
    expect(live2dMotionFor('happy', { motions: {} }, ['Idle', 'Use'])).toEqual({ group: 'Use' })
  })

  it('finds model3.json up to two levels deep and plans zip imports', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soulpet-l2d-'))
    try {
      fs.mkdirSync(path.join(dir, 'runtime', 'motion'), { recursive: true })
      fs.writeFileSync(path.join(dir, 'runtime', 'hiyori.model3.json'), '{}')
      expect(findModel3(dir)).toBe('runtime/hiyori.model3.json')
      expect(findModel3(path.join(dir, 'runtime', 'motion'))).toBeNull()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
    const plan = planImport(['hiyori/', 'hiyori/runtime/hiyori.model3.json', 'hiyori/runtime/hiyori.moc3'], 'x.zip')
    expect(plan).toMatchObject({ name: 'hiyori', kind: 'live2d' })
    expect(plan.files.map((f) => f.to)).toEqual(['runtime/hiyori.model3.json', 'runtime/hiyori.moc3'])
    // manifest + model one level down inside a single top folder: strip the folder so manifest.json is at the root
    const withManifest = planImport(['Hiyori/manifest.json', 'Hiyori/hiyori.model3.json', 'Hiyori/hiyori.moc3'], 'download.zip')
    expect(withManifest.name).toBe('Hiyori')
    expect(withManifest.files.map((f) => f.to)).toEqual(['manifest.json', 'hiyori.model3.json', 'hiyori.moc3'])
  })
})
