import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
import { findModel3 } from './model3'
import {
  builtinPack,
  normalizeCodexPack,
  normalizeFramesPack,
  normalizeLive2DPack,
  type CodexPetJson,
  type FramesManifest,
  type Live2DManifest,
  type PackIO,
  type ResolvedPack
} from '../core/pets/pack'

export const ASSET_SCHEME = 'soulpet-asset'

export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
  ])
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

/** Scans built-in and user pack folders and serves their files over soulpet-asset://. */
export const LIVE2D_CORE_FILE = 'live2dcubismcore.min.js'

export class PackManager {
  private roots = new Map<string, string>()
  packs: ResolvedPack[] = []

  constructor(
    private readonly builtinDir: string,
    readonly userDir: string,
    /** where a user-supplied Live2D Cubism Core is kept */
    readonly coreDir: string
  ) {
    fs.mkdirSync(userDir, { recursive: true })
  }

  private coreInstalled = false

  /**
   * URL of the user-installed Live2D Cubism Core. Cores bundled inside downloaded packs are
   * deliberately ignored: the core runs as script in the pet window, so only a file the user
   * picked explicitly (and that passed the content check) may be executed.
   */
  coreUrl(): string | null {
    return this.coreInstalled ? `${ASSET_SCHEME}://pack/core/${LIVE2D_CORE_FILE}` : null
  }

  installProtocol(): void {
    protocol.handle(ASSET_SCHEME, async (req) => {
      const url = new URL(req.url)
      const [, key, ...rest] = url.pathname.split('/')
      const root = this.roots.get(decodeURIComponent(key ?? ''))
      if (!root) return new Response('not found', { status: 404 })
      const abs = path.resolve(root, ...rest.map(decodeURIComponent))
      if (!abs.startsWith(path.resolve(root) + path.sep)) return new Response('forbidden', { status: 403 })
      if (!isFile(abs)) return new Response('not found', { status: 404 })
      return net.fetch(pathToFileURL(abs).toString())
    })
  }

  private io(key: string, root: string): PackIO {
    return {
      url: (rel) => `${ASSET_SCHEME}://pack/${encodeURIComponent(key)}/${rel.split('/').map(encodeURIComponent).join('/')}`,
      exists: (rel) => fs.existsSync(path.join(root, rel)),
      list: (rel) => {
        try {
          const dir = path.join(root, rel)
          return fs.readdirSync(dir).filter((f) => isFile(path.join(dir, f)))
        } catch {
          return []
        }
      }
    }
  }

  private scanDir(dir: string, source: ResolvedPack['source']): ResolvedPack[] {
    if (!fs.existsSync(dir)) return []
    const out: ResolvedPack[] = []
    for (const name of fs.readdirSync(dir).sort()) {
      const root = path.join(dir, name)
      try {
        if (!fs.statSync(root).isDirectory()) continue
        const key = `${source === 'builtin' ? 'b' : 'u'}:${name}`
        const io = this.io(key, root)
        let pack: ResolvedPack | null = null
        const manifest = path.join(root, 'manifest.json')
        const petJson = path.join(root, 'pet.json')
        if (isFile(manifest)) {
          const m = JSON.parse(fs.readFileSync(manifest, 'utf8'))
          pack = m?.format === 'live2d' ? normalizeLive2DPack(m as Live2DManifest, name, io, source) : normalizeFramesPack(m as FramesManifest, name, io, source)
        } else if (isFile(petJson)) {
          pack = normalizeCodexPack(JSON.parse(fs.readFileSync(petJson, 'utf8')) as CodexPetJson, name, io, source)
        } else if (isFile(path.join(root, 'spritesheet.webp')) || isFile(path.join(root, 'spritesheet.png'))) {
          pack = normalizeCodexPack({}, name, io, source)
        } else {
          const model = findModel3(root)
          if (model) pack = normalizeLive2DPack({ format: 'live2d', name, model }, name, io, source)
        }
        if (!pack) continue
        // Ids must be unique across folders; prefix user packs that collide.
        if (out.some((p) => p.id === pack!.id) || this.packs.some((p) => p.id === pack!.id && p.source !== source)) {
          pack = { ...pack, id: `${key}` }
        }
        this.roots.set(key, root)
        out.push({ ...pack, folder: name })
      } catch (e) {
        console.error('[packs] failed to load', root, e)
      }
    }
    return out
  }

  scan(): ResolvedPack[] {
    this.roots.clear()
    this.coreInstalled = isFile(path.join(this.coreDir, LIVE2D_CORE_FILE))
    if (this.coreInstalled) this.roots.set('core', this.coreDir)
    this.packs = []
    const builtin = this.scanDir(this.builtinDir, 'builtin')
    this.packs = [builtinPack(), ...builtin]
    const user = this.scanDir(this.userDir, 'user').map((p) => (this.packs.some((b) => b.id === p.id) ? { ...p, id: `user:${p.id}` } : p))
    this.packs = [...this.packs, ...user]
    return this.packs
  }

  get(id: string): ResolvedPack | undefined {
    return this.packs.find((p) => p.id === id)
  }
}
