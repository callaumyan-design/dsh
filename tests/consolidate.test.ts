import { describe, expect, it } from 'vitest'
import { applyMerges, buildConsolidationMessages, findClusters, forgettable, parseMerges } from '../src/core/memory/consolidate'
import { MemoryStore } from '../src/core/memory/store'
import { DAY } from '../src/core/util'

const NOW = new Date(2026, 10, 3, 12).getTime()

function seed() {
  const store = new MemoryStore()
  const a = store.add({ text: '用户喜欢吃草莓', importance: 6 }, NOW - 10 * DAY).item
  const b = store.add({ text: '用户特别喜欢吃草莓蛋糕', importance: 7 }, NOW - 2 * DAY).item
  const c = store.add({ text: '用户在上海做程序员', importance: 6 }, NOW).item
  const d = store.add({ text: '用户的生日是3月5日', importance: 10, pinned: true }, NOW).item
  const e = store.add({ text: '用户的生日在3月5日那天', importance: 9 }, NOW).item
  return { store, a, b, c, d, e }
}

describe('consolidation', () => {
  it('clusters similar non-pinned memories', () => {
    const { store, a, b, c, d } = seed()
    const clusters = findClusters(store.all())
    const ids = clusters.map((cl) => cl.map((m) => m.id).sort())
    expect(ids).toContainEqual([a.id, b.id].sort())
    expect(ids.flat()).not.toContain(c.id)
    expect(ids.flat()).not.toContain(d.id) // pinned memories are never merged
  })

  it('uses embeddings when lexical similarity is low', () => {
    const store = new MemoryStore()
    const x = store.add({ text: '用户周末爱爬山' }, NOW).item
    const y = store.add({ text: '用户喜欢户外徒步' }, NOW).item
    store.setEmbedding(x.id, [1, 0.1], 'm')
    store.setEmbedding(y.id, [0.98, 0.12], 'm')
    expect(findClusters(store.all())).toHaveLength(1)
  })

  it('applies merges only within proposed clusters and keeps stats', () => {
    const { store, a, b, c } = seed()
    store.touch([a.id], NOW)
    const clusters = findClusters(store.all())
    const merges = parseMerges(
      `{"merges":[{"ids":["${a.id}","${b.id}"],"text":"用户很喜欢草莓，尤其是草莓蛋糕","importance":8},{"ids":["${a.id}","${c.id}"],"text":"bad"}]}`
    )
    expect(merges).toHaveLength(2)
    expect(applyMerges(store, merges, clusters, NOW)).toBe(1)
    expect(store.get(a.id)).toBeUndefined()
    expect(store.get(c.id)).toBeDefined()
    const merged = store.all().find((m) => m.text.includes('草莓蛋糕'))!
    expect(merged.importance).toBe(8)
    expect(merged.accessCount).toBe(1)
    expect(merged.createdAt).toBe(NOW - 10 * DAY)
  })

  it('builds a prompt listing ids and parses junk safely', () => {
    const { store } = seed()
    const msgs = buildConsolidationMessages('团子', findClusters(store.all()))
    expect(msgs[1].content).toMatch(/第 1 组/)
    expect(parseMerges('no json')).toEqual([])
    expect(parseMerges('{"merges":[{"ids":["x"],"text":"one id"}]}')).toEqual([])
  })

  it('forgets only trivial, long-unrecalled, unpinned memories', () => {
    const store = new MemoryStore()
    const old = store.add({ text: '用户说今天天气不错', importance: 2 }, NOW - 200 * DAY).item
    store.add({ text: '用户的猫叫豆豆', importance: 8 }, NOW - 200 * DAY)
    store.add({ text: '随口一提', importance: 1 }, NOW)
    expect(forgettable(store.all(), NOW).map((m) => m.id)).toEqual([old.id])
  })
})
