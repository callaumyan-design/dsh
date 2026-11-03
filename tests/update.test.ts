import { describe, expect, it } from 'vitest'
import { checkForUpdate, compareVersions, latestRelease } from '../src/core/update'

describe('update check', () => {
  it('compares versions numerically', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1)
    expect(compareVersions('v1.2', '1.2.0')).toBe(0)
    expect(compareVersions('0.2.0', '0.2.1')).toBe(-1)
  })

  it('ignores drafts, prereleases and non-SoulPet tags', () => {
    const r = latestRelease([
      { tag_name: 'v2.0.0', html_url: 'dsh' },
      { tag_name: 'soulpet-v0.3.0', draft: true },
      { tag_name: 'soulpet-v0.4.0-beta', prerelease: true },
      { tag_name: 'soulpet-v0.2.1', html_url: 'u1', name: 'SoulPet 0.2.1' },
      { tag_name: 'soulpet-v0.10.0', html_url: 'u2' }
    ])
    expect(r?.version).toBe('0.10.0')
    expect(latestRelease('nope')).toBeNull()
  })

  it('returns only newer releases', async () => {
    const f = async () => new Response(JSON.stringify([{ tag_name: 'soulpet-v0.3.0', html_url: 'x' }]), { status: 200 })
    expect((await checkForUpdate('0.2.0', f))?.version).toBe('0.3.0')
    expect(await checkForUpdate('0.3.0', f)).toBeNull()
    await expect(checkForUpdate('0.2.0', async () => new Response('', { status: 403 }))).rejects.toThrow(/403/)
  })
})
