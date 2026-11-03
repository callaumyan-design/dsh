import fs from 'node:fs'
import path from 'node:path'

/** Find a *.model3.json in the pack root or up to two folder levels down (e.g. runtime/). */
export function findModel3(root: string, depth = 2): string | null {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return null
  }
  const hit = entries.find((e) => e.isFile() && e.name.toLowerCase().endsWith('.model3.json'))
  if (hit) return hit.name
  if (depth <= 0) return null
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue
    const sub = findModel3(path.join(root, e.name), depth - 1)
    if (sub) return `${e.name}/${sub}`
  }
  return null
}

