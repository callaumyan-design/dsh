/**
 * Pet pack ("形象包") model.
 *
 * Three kinds are supported:
 *  - builtin: the procedural SVG slime drawn by the renderer (no files)
 *  - codex:   Codex Pet format: pet.json + an 8x9 (v1) or 8x11 (v2) spritesheet of 192x208 cells
 *  - frames:  SoulPet manifest.json mapping states to GIF/APNG/WebP/PNG sequences/WebM
 *
 * Normalisation is pure; the main process injects `url()` (relative path -> loadable URL)
 * and `list()` (directory listing) so this file has no fs dependency and can be unit tested.
 */
import type { PetAnimState } from '../game/types'

export type AnimSpec =
  | { type: 'sheet'; src: string; cols: number; frameW: number; frameH: number; row: number; frames: number; fps: number; loop: boolean }
  | { type: 'frames'; srcs: string[]; fps: number; loop: boolean }
  | { type: 'image'; src: string }
  | { type: 'video'; src: string; loop: boolean }

export type PackKind = 'builtin' | 'codex' | 'frames'

export interface ResolvedPack {
  id: string
  name: string
  kind: PackKind
  description?: string
  author?: string
  license?: string
  /** Natural size of one frame in CSS px at scale 1. */
  width: number
  height: number
  /** Which way the art faces. Used to decide when to mirror walk animations. */
  facing: 'left' | 'right'
  anims: Partial<Record<PetAnimState, AnimSpec>>
  /** Optional per-growth-stage overrides. */
  stages?: Partial<Record<'baby' | 'child' | 'adult', Partial<Record<PetAnimState, AnimSpec>>>>
  preview?: AnimSpec
  source: 'builtin' | 'user'
  warnings: string[]
}

export const ANIM_STATES: PetAnimState[] = [
  'idle', 'walk', 'walk_left', 'drag', 'fall', 'sleep', 'eat', 'happy', 'sad', 'angry', 'surprised', 'shy',
  'think', 'talk', 'work', 'sick', 'play', 'bath', 'wave', 'jump'
]

/** When a pack lacks a state, try these (in order), finally `idle`. */
export const FALLBACKS: Record<PetAnimState, PetAnimState[]> = {
  idle: [],
  walk: ['idle'],
  walk_left: ['walk'],
  drag: ['jump', 'surprised', 'wave'],
  fall: ['jump', 'drag'],
  sleep: ['think'],
  eat: ['happy', 'talk'],
  happy: ['wave', 'jump'],
  sad: ['sick'],
  angry: ['sad'],
  surprised: ['jump', 'happy'],
  shy: ['happy', 'wave'],
  think: ['talk'],
  talk: ['wave', 'happy'],
  work: ['think', 'talk'],
  sick: ['sad', 'sleep'],
  play: ['jump', 'happy'],
  bath: ['happy'],
  wave: ['happy', 'jump'],
  jump: ['happy', 'wave']
}

export interface PickedAnim {
  spec: AnimSpec
  state: PetAnimState
  /** Mirror horizontally (e.g. walking left with only a right-facing walk). */
  flip: boolean
}

export function pickAnim(pack: ResolvedPack, wanted: PetAnimState, stage?: 'baby' | 'child' | 'adult'): PickedAnim | null {
  const table = { ...pack.anims, ...(stage && pack.stages?.[stage] ? pack.stages[stage] : {}) }
  const seen = new Set<PetAnimState>()
  const queue: PetAnimState[] = [wanted]
  while (queue.length) {
    const s = queue.shift()!
    if (seen.has(s)) continue
    seen.add(s)
    const spec = table[s]
    if (spec) {
      // walk_left resolved via walk: mirror if the art faces right.
      const flip = wanted === 'walk_left' && s !== 'walk_left' ? pack.facing === 'right' : wanted === 'walk' && pack.facing === 'left'
      return { spec, state: s, flip }
    }
    queue.push(...FALLBACKS[s])
  }
  const idle = table.idle
  return idle ? { spec: idle, state: 'idle', flip: false } : null
}

// ---------------------------------------------------------------------------
// Codex Pet format
// ---------------------------------------------------------------------------

export const CODEX = {
  cols: 8,
  frameW: 192,
  frameH: 208,
  /** Standard rows, top to bottom, with the number of used frames in each. */
  rows: [
    { name: 'idle', frames: 6 },
    { name: 'running-right', frames: 8 },
    { name: 'running-left', frames: 8 },
    { name: 'waving', frames: 4 },
    { name: 'jumping', frames: 5 },
    { name: 'failed', frames: 8 },
    { name: 'waiting', frames: 6 },
    { name: 'running', frames: 6 },
    { name: 'review', frames: 6 }
  ]
} as const

/** Which Codex row plays for each of our states. Missing states use FALLBACKS. */
export const CODEX_STATE_ROWS: Partial<Record<PetAnimState, string>> = {
  idle: 'idle',
  walk: 'running-right',
  walk_left: 'running-left',
  wave: 'waving',
  jump: 'jumping',
  happy: 'jumping',
  sad: 'failed',
  sick: 'failed',
  think: 'waiting',
  sleep: 'waiting',
  work: 'running',
  talk: 'review'
}

export interface CodexPetJson {
  id?: string
  displayName?: string
  name?: string
  description?: string
  author?: string
  license?: string
  spritesheetPath?: string
  spriteVersionNumber?: number
  /** SoulPet extension: frames per second (Codex does not define timing). */
  fps?: number
  /** SoulPet extension: override row mapping, e.g. { "sleep": "review" } */
  soulpet?: { fps?: number; rows?: Partial<Record<PetAnimState, string>> }
}

export interface PackIO {
  /** relative path inside the pack -> URL the renderer can load */
  url(rel: string): string
  /** whether a relative path exists */
  exists(rel: string): boolean
  /** list files (not dirs) in a relative directory, unsorted */
  list(rel: string): string[]
}

export function normalizeCodexPack(json: CodexPetJson, fallbackId: string, io: PackIO, source: ResolvedPack['source']): ResolvedPack {
  const warnings: string[] = []
  const candidates = [json.spritesheetPath, 'spritesheet.webp', 'spritesheet.png'].filter((x): x is string => !!x)
  const sheet = candidates.find((c) => io.exists(c))
  if (!sheet) warnings.push(`找不到精灵图（尝试了 ${candidates.join(', ')}）`)
  const fps = json.soulpet?.fps ?? json.fps ?? 8
  const rowIndex = new Map<string, number>(CODEX.rows.map((r, i) => [r.name, i]))
  const mapping = { ...CODEX_STATE_ROWS, ...(json.soulpet?.rows ?? {}) }
  const anims: ResolvedPack['anims'] = {}
  if (sheet) {
    for (const [state, rowName] of Object.entries(mapping) as Array<[PetAnimState, string]>) {
      const idx = rowIndex.get(rowName)
      if (idx === undefined) {
        warnings.push(`未知的 Codex 行名：${rowName}`)
        continue
      }
      anims[state] = {
        type: 'sheet',
        src: io.url(sheet),
        cols: CODEX.cols,
        frameW: CODEX.frameW,
        frameH: CODEX.frameH,
        row: idx,
        frames: CODEX.rows[idx].frames,
        fps: state === 'sleep' ? Math.max(2, Math.round(fps / 2)) : fps,
        loop: true
      }
    }
  }
  return {
    id: json.id || fallbackId,
    name: json.displayName || json.name || json.id || fallbackId,
    kind: 'codex',
    description: json.description,
    author: json.author,
    license: json.license,
    width: CODEX.frameW,
    height: CODEX.frameH,
    facing: 'right',
    anims,
    preview: anims.idle,
    source,
    warnings
  }
}

// ---------------------------------------------------------------------------
// SoulPet frames manifest
// ---------------------------------------------------------------------------

export type FrameStateSpec =
  | string
  | string[]
  | { src?: string; frames?: string[]; dir?: string; fps?: number; loop?: boolean }

export interface FramesManifest {
  format?: 'soulpet-frames'
  id?: string
  name?: string
  description?: string
  author?: string
  license?: string
  size?: [number, number] | { width: number; height: number }
  facing?: 'left' | 'right'
  fps?: number
  states: Partial<Record<PetAnimState, FrameStateSpec>>
  stages?: Partial<Record<'baby' | 'child' | 'adult', Partial<Record<PetAnimState, FrameStateSpec>>>>
}

const VIDEO_EXT = /\.(webm|mp4|mov)$/i
const IMAGE_EXT = /\.(gif|png|apng|webp|jpe?g|svg)$/i

/** Natural sort so frame_2.png comes before frame_10.png. */
export function naturalSort(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

function resolveStateSpec(spec: FrameStateSpec, defaultFps: number, io: PackIO, warn: (m: string) => void, label: string): AnimSpec | null {
  if (typeof spec === 'string') {
    if (!io.exists(spec)) return warn(`${label}: 找不到 ${spec}`), null
    if (VIDEO_EXT.test(spec)) return { type: 'video', src: io.url(spec), loop: true }
    if (IMAGE_EXT.test(spec)) return { type: 'image', src: io.url(spec) }
    // treat as a directory of frames
    return resolveStateSpec({ dir: spec }, defaultFps, io, warn, label)
  }
  if (Array.isArray(spec)) return resolveStateSpec({ frames: spec }, defaultFps, io, warn, label)
  const fps = spec.fps ?? defaultFps
  const loop = spec.loop ?? true
  if (spec.src) {
    const inner = resolveStateSpec(spec.src, fps, io, warn, label)
    if (inner?.type === 'video') return { ...inner, loop }
    return inner
  }
  let frames = spec.frames ?? []
  if (spec.dir) {
    const dir = spec.dir.replace(/\/+$/, '')
    frames = io
      .list(dir)
      .filter((f) => IMAGE_EXT.test(f))
      .sort(naturalSort)
      .map((f) => `${dir}/${f}`)
  }
  const present = frames.filter((f) => io.exists(f))
  if (present.length < frames.length) warn(`${label}: 有 ${frames.length - present.length} 帧文件缺失`)
  if (!present.length) return warn(`${label}: 没有可用的帧`), null
  if (present.length === 1) return { type: 'image', src: io.url(present[0]) }
  return { type: 'frames', srcs: present.map((f) => io.url(f)), fps, loop }
}

export function normalizeFramesPack(m: FramesManifest, fallbackId: string, io: PackIO, source: ResolvedPack['source']): ResolvedPack {
  const warnings: string[] = []
  const warn = (msg: string) => warnings.push(msg)
  const fps = m.fps ?? 8
  const size = Array.isArray(m.size) ? { width: m.size[0], height: m.size[1] } : m.size ?? { width: 180, height: 180 }
  const anims: ResolvedPack['anims'] = {}
  for (const [state, spec] of Object.entries(m.states ?? {}) as Array<[PetAnimState, FrameStateSpec]>) {
    if (!ANIM_STATES.includes(state)) {
      warn(`未知状态名：${state}`)
      continue
    }
    const a = resolveStateSpec(spec, fps, io, warn, state)
    if (a) anims[state] = a
  }
  if (!anims.idle) warn('缺少 idle 状态，宠物可能无法显示')
  let stages: ResolvedPack['stages']
  if (m.stages) {
    stages = {}
    for (const [stage, table] of Object.entries(m.stages) as Array<['baby' | 'child' | 'adult', Partial<Record<PetAnimState, FrameStateSpec>>]>) {
      const out: Partial<Record<PetAnimState, AnimSpec>> = {}
      for (const [state, spec] of Object.entries(table ?? {}) as Array<[PetAnimState, FrameStateSpec]>) {
        const a = resolveStateSpec(spec, fps, io, warn, `${stage}.${state}`)
        if (a) out[state] = a
      }
      stages[stage] = out
    }
  }
  return {
    id: m.id || fallbackId,
    name: m.name || m.id || fallbackId,
    kind: 'frames',
    description: m.description,
    author: m.author,
    license: m.license,
    width: Math.max(32, Math.min(1024, size.width)),
    height: Math.max(32, Math.min(1024, size.height)),
    facing: m.facing ?? 'right',
    anims,
    stages,
    preview: anims.idle,
    source,
    warnings
  }
}

export const BUILTIN_PACK_ID = 'builtin:dango'

export function builtinPack(): ResolvedPack {
  return {
    id: BUILTIN_PACK_ID,
    name: '团子（内置史莱姆）',
    kind: 'builtin',
    description: '原创矢量史莱姆，可以在设置里换颜色和饰品',
    author: 'SoulPet',
    license: 'MIT',
    width: 170,
    height: 150,
    facing: 'right',
    anims: {},
    source: 'builtin',
    warnings: []
  }
}
