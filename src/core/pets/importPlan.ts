/**
 * Decide how to unpack a pet-pack archive safely: reject path traversal, skip junk,
 * strip a single top-level folder, and require a recognisable pack manifest.
 */
export interface ImportPlan {
  /** folder name to create under the user pets directory */
  name: string
  /** archive path -> relative output path */
  files: Array<{ from: string; to: string }>
  kind: 'codex' | 'frames' | 'live2d'
}

const JUNK = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)/i

export function sanitizeFolderName(name: string): string {
  const clean = name
    .replace(/\.(zip|petpack)$/i, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 60)
  return clean || 'pet'
}

export function planImport(paths: string[], archiveName: string): ImportPlan {
  const files = paths
    .map((p) => p.replace(/\\/g, '/'))
    .filter((p) => !p.endsWith('/') && !JUNK.test(p))
  if (!files.length) throw new Error('压缩包是空的')
  for (const p of files) {
    if (p.startsWith('/') || /^[a-zA-Z]:/.test(p) || p.split('/').some((seg) => seg === '..')) {
      throw new Error(`压缩包里有不安全的路径：${p}`)
    }
  }
  const MARKERS = ['pet.json', 'manifest.json', 'spritesheet.webp', 'spritesheet.png']
  const isModel3 = (p: string, maxDepth: number) => /\.model3\.json$/i.test(p) && p.split('/').length <= maxDepth
  // a pack root has a marker file directly in it (or a Live2D model at most one folder down)
  const looksLikeRoot = (list: string[], modelDepth: number) => list.some((p) => MARKERS.includes(p) || isModel3(p, modelDepth))
  let prefix = ''
  if (!looksLikeRoot(files, 1)) {
    const tops = new Set(files.map((p) => p.split('/')[0]))
    if (tops.size === 1) {
      const top = [...tops][0]
      const inner = files.map((p) => p.slice(top.length + 1))
      if (looksLikeRoot(inner, 2)) prefix = top + '/'
    }
  }
  const rel = files.filter((p) => p.startsWith(prefix)).map((p) => ({ from: p, to: p.slice(prefix.length) }))
  const names = new Set(rel.map((f) => f.to))
  const hasModel3 = [...names].some((n) => /\.model3\.json$/i.test(n) && n.split('/').length <= 3)
  const kind: ImportPlan['kind'] | null = names.has('manifest.json')
    ? 'frames'
    : names.has('pet.json') || names.has('spritesheet.webp') || names.has('spritesheet.png')
      ? 'codex'
      : hasModel3
        ? 'live2d'
        : null
  if (!kind) throw new Error('没有找到 pet.json、manifest.json 或 Live2D 模型（*.model3.json），这可能不是形象包')
  return { name: sanitizeFolderName(prefix ? prefix.slice(0, -1) : archiveName), files: rel, kind }
}

/** Pick a folder name that does not exist yet: name, name-2, name-3 ... */
export function uniqueName(name: string, exists: (n: string) => boolean): string {
  if (!exists(name)) return name
  for (let i = 2; i < 1000; i++) if (!exists(`${name}-${i}`)) return `${name}-${i}`
  return `${name}-${Date.now()}`
}
