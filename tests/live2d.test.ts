import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { planImport } from '../src/core/pets/importPlan'
import { live2dMotionFor, normalizeLive2DPack, type PackIO } from '../src/core/pets/pack'
import { findModel3 } from '../src/main/model3'

const io = (files: string[]): PackIO => ({ url: (r) => `asset://x/${r}`, exists: (r) => files.includes(r), list: () => [] })

describe('live2d packs', () => {
  it('normalizes a manifest and finds a bundled core', () => {
    const p = normalizeLive2DPack({ format: 'live2d', name: '春', model: 'runtime/haru.model3.json', size: [260, 380], zoom: 1.2 }, 'haru', io(['runtime/haru.model3.json', 'live2dcubismcore.min.js']), 'user')
    expect(p.kind).toBe('live2d')
    expect(p.width).toBe(260)
    expect(p.live2d).toMatchObject({ model: 'asset://x/runtime/haru.model3.json', zoom: 1.2, core: 'asset://x/live2dcubismcore.min.js' })
    expect(p.warnings).toEqual([])
    expect(normalizeLive2DPack({ format: 'live2d', model: 'a.moc' }, 'x', io([]), 'user').warnings.length).toBe(2)
  })

  it('maps states to motion groups', () => {
    const groups = ['Idle', 'TapBody', 'Talk']
    expect(live2dMotionFor('idle', { motions: {} }, groups)).toEqual({ group: 'Idle' })
    expect(live2dMotionFor('talk', { motions: {} }, groups)).toEqual({ group: 'Talk' })
    expect(live2dMotionFor('happy', { motions: {} }, groups)).toEqual({ group: 'TapBody' })
    expect(live2dMotionFor('think', { motions: {} }, groups)).toEqual({ group: 'Idle' })
    expect(live2dMotionFor('happy', { motions: { happy: 'TapBody:2' } }, groups)).toEqual({ group: 'TapBody', index: 2 })
    expect(live2dMotionFor('happy', { motions: { happy: 'Nope' } }, groups)).toBeNull()
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
  })
})
