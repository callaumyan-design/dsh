import { describe, expect, it } from 'vitest'
import { createGame } from '../src/core/game/engine'
import { personaFromCard, personaFromCardFile, readPngText } from '../src/core/persona/card'
import { builtinPack, normalizeCodexPack, normalizeFramesPack, pickAnim, type PackIO } from '../src/core/pets/pack'
import { decideProactive, freshProactiveState, proactiveLine, recordProactive, type ProactiveContext } from '../src/core/proactive'
import { defaultSettings, normalizeSettings } from '../src/core/settings'

function fakeIO(files: string[]): PackIO {
  const set = new Set(files)
  return {
    url: (rel) => `asset://p/${rel}`,
    exists: (rel) => set.has(rel) || files.some((f) => f.startsWith(rel + '/')),
    list: (rel) => files.filter((f) => f.startsWith(rel + '/')).map((f) => f.slice(rel.length + 1))
  }
}

describe('pet packs', () => {
  it('normalizes a Codex pet and maps rows', () => {
    const p = normalizeCodexPack({ id: 'cat', displayName: '小猫', spritesheetPath: 'spritesheet.webp' }, 'dir', fakeIO(['spritesheet.webp']), 'user')
    expect(p.name).toBe('小猫')
    expect(p.warnings).toEqual([])
    const walkLeft = pickAnim(p, 'walk_left')!
    expect(walkLeft.spec).toMatchObject({ type: 'sheet', row: 2, frames: 8 })
    expect(walkLeft.flip).toBe(false)
    expect(pickAnim(p, 'think')!.spec).toMatchObject({ row: 6 })
    // eat is not in Codex -> falls back via happy -> jumping row
    expect(pickAnim(p, 'eat')!.spec).toMatchObject({ row: 4 })
  })

  it('falls back to spritesheet.png and warns when missing', () => {
    expect(normalizeCodexPack({}, 'd', fakeIO(['spritesheet.png']), 'user').anims.idle).toMatchObject({ src: 'asset://p/spritesheet.png' })
    expect(normalizeCodexPack({}, 'd', fakeIO([]), 'user').warnings[0]).toMatch(/找不到精灵图/)
  })

  it('normalizes a frames manifest (gif, webm, dir of frames)', () => {
    const io = fakeIO(['idle.gif', 'talk.webm', 'walk/f10.png', 'walk/f2.png', 'walk/f1.png'])
    const p = normalizeFramesPack(
      { name: '自制', facing: 'left', size: [200, 220], states: { idle: 'idle.gif', talk: 'talk.webm', walk: { dir: 'walk', fps: 12 }, sleep: 'nope.gif' } },
      'mine',
      io,
      'user'
    )
    expect(p.anims.idle).toEqual({ type: 'image', src: 'asset://p/idle.gif' })
    expect(p.anims.talk).toEqual({ type: 'video', src: 'asset://p/talk.webm', loop: true })
    expect(p.anims.walk).toEqual({ type: 'frames', srcs: ['asset://p/walk/f1.png', 'asset://p/walk/f2.png', 'asset://p/walk/f10.png'], fps: 12, loop: true })
    expect(p.warnings.join()).toMatch(/nope\.gif/)
    // left-facing art: walking right must be mirrored, walking left must not
    expect(pickAnim(p, 'walk')!.flip).toBe(true)
    expect(pickAnim(p, 'walk_left')!.flip).toBe(false)
    // sleep missing -> think -> talk
    expect(pickAnim(p, 'sleep')!.state).toBe('talk')
  })

  it('builtin pack has no assets (renderer draws it)', () => {
    expect(pickAnim(builtinPack(), 'idle')).toBeNull()
  })
})

describe('character cards', () => {
  const card = {
    spec: 'chara_card_v2',
    data: { name: '小狐', description: '{{char}}是一只狐狸', personality: '狡黠', scenario: '住在{{user}}的电脑里', first_mes: '嗨，{{user}}', mes_example: '' }
  }

  it('maps V2 JSON fields', () => {
    const p = personaFromCard(card, '主人')
    expect(p).toMatchObject({ name: '小狐', personality: '狡黠\n小狐是一只狐狸', background: '住在主人的电脑里', greeting: '嗨，主人' })
  })

  it('reads a card embedded in a PNG tEXt chunk', () => {
    const json = Buffer.from(JSON.stringify(card), 'utf8').toString('base64')
    const chunk = (type: string, data: Buffer) => {
      const len = Buffer.alloc(4)
      len.writeUInt32BE(data.length)
      return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)])
    }
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', Buffer.alloc(13)),
      chunk('tEXt', Buffer.concat([Buffer.from('chara\0', 'latin1'), Buffer.from(json, 'latin1')])),
      chunk('IEND', Buffer.alloc(0))
    ])
    expect(Object.keys(readPngText(new Uint8Array(png)))).toEqual(['chara'])
    expect(personaFromCardFile(new Uint8Array(png)).name).toBe('小狐')
  })

  it('rejects cards without a name', () => {
    expect(() => personaFromCard({ data: {} })).toThrow()
  })
})

describe('proactive', () => {
  const base = (over: Partial<ProactiveContext> = {}): ProactiveContext => ({
    now: new Date(2026, 10, 3, 15, 0),
    settings: { level: 'medium', quietEnabled: true, quietStart: '23:00', quietEnd: '08:00', useAI: false },
    dnd: false,
    game: createGame(Date.now()),
    state: freshProactiveState(new Date(2026, 10, 3, 15).getTime()),
    systemIdleSec: 5,
    returnedAfterSec: 0,
    lastPetInteractionAt: new Date(2026, 10, 3, 14, 30).getTime(),
    random: () => 0.99,
    ...over
  })

  it('stays quiet normally, speaks when hungry', () => {
    expect(decideProactive(base())).toBeNull()
    const g = createGame(Date.now())
    expect(decideProactive(base({ game: { ...g, stats: { ...g.stats, satiety: 10 } } }))).toBe('hungry')
  })

  it('respects DND, quiet hours, idle and daily budget', () => {
    const g = createGame(Date.now())
    const hungry = { ...g, stats: { ...g.stats, satiety: 10 } }
    expect(decideProactive(base({ game: hungry, dnd: true }))).toBeNull()
    expect(decideProactive(base({ game: hungry, now: new Date(2026, 10, 3, 23, 30) }))).toBeNull()
    expect(decideProactive(base({ game: hungry, systemIdleSec: 900 }))).toBeNull()
    const spent = { ...freshProactiveState(new Date(2026, 10, 3).getTime()), count: 6 }
    expect(decideProactive(base({ game: hungry, state: spent }))).toBeNull()
  })

  it('greets in the morning once, and when the user returns', () => {
    const morning = new Date(2026, 10, 3, 8, 30)
    expect(decideProactive(base({ now: morning }))).toBe('morning')
    const st = recordProactive(freshProactiveState(morning.getTime()), 'morning', morning.getTime())
    expect(decideProactive(base({ now: morning, state: st }))).toBeNull()
    expect(decideProactive(base({ returnedAfterSec: 3600 }))).toBe('back')
  })

  it('fills the user name into lines', () => {
    expect(proactiveLine('back', '小明', () => 0)).toContain('小明')
  })
})

describe('settings', () => {
  it('keeps user providers and appends new presets', () => {
    const s = normalizeSettings({ providers: [{ id: 'mine', name: 'Mine', kind: 'openai', baseURL: 'x', model: 'y' }], activeProviderId: 'mine', appearance: { scale: 9 } })
    expect(s.providers[0].id).toBe('mine')
    expect(s.providers.some((p) => p.id === 'deepseek')).toBe(true)
    expect(s.appearance.scale).toBe(2)
    expect(s.proactive.level).toBe(defaultSettings().proactive.level)
  })
})
