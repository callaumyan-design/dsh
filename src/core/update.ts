/** Lightweight update check against GitHub Releases (tags like soulpet-v0.2.0). */

export const RELEASE_REPO = 'callaumyan-design/dsh'
export const TAG_PREFIX = 'soulpet-v'

export interface ReleaseInfo {
  version: string
  url: string
  name: string
  publishedAt: string
}

/** Compare dotted versions numerically: 1 if a>b, -1 if a<b, 0 if equal. Ignores pre-release suffixes. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  const pb = b.replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d > 0 ? 1 : -1
  }
  return 0
}

interface GhRelease {
  tag_name?: string
  html_url?: string
  name?: string
  draft?: boolean
  prerelease?: boolean
  published_at?: string
}

/** Pick the newest published SoulPet release from a GitHub /releases response. */
export function latestRelease(releases: unknown): ReleaseInfo | null {
  if (!Array.isArray(releases)) return null
  let best: ReleaseInfo | null = null
  for (const r of releases as GhRelease[]) {
    if (!r || r.draft || r.prerelease || !r.tag_name?.startsWith(TAG_PREFIX)) continue
    const version = r.tag_name.slice(TAG_PREFIX.length)
    if (!best || compareVersions(version, best.version) > 0) {
      best = { version, url: r.html_url ?? '', name: r.name ?? r.tag_name, publishedAt: r.published_at ?? '' }
    }
  }
  return best
}

export async function checkForUpdate(current: string, f: (url: string, init?: RequestInit) => Promise<Response>): Promise<ReleaseInfo | null> {
  const res = await f(`https://api.github.com/repos/${RELEASE_REPO}/releases?per_page=30`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'SoulPet-update-check' }
  })
  if (!res.ok) throw new Error(`GitHub 返回 ${res.status}`)
  const latest = latestRelease(await res.json())
  return latest && compareVersions(latest.version, current) > 0 ? latest : null
}
