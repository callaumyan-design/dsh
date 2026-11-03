import { describe, expect, it } from 'vitest'
import { applyMemoryOps, buildExtractionMessages, detectExplicitRemember, parseMemoryOps, toThirdPerson } from '../src/core/memory/extract'
import { parseDiary } from '../src/core/memory/diary'
import { MemoryStore } from '../src/core/memory/store'
import { bigramSimilarity, bm25, tokenize } from '../src/core/memory/text'
import { DAY } from '../src/core/util'

const NOW = new Date(2026, 10, 3, 12).getTime()

describe('tokenizer / bm25', () => {
  it('produces Chinese unigrams+bigrams and latin words', () => {
    const t = tokenize('我喜欢吃草莓 and Coffee')
    expect(t).toContain('草莓')
    expect(t).toContain('喜欢')
    expect(t).not.toContain('我')
    expect(t).toContain('coffee')
    expect(t).not.toContain('and')
  })

  it('ranks the relevant doc first', () => {
    const docs = ['用户喜欢吃草莓蛋糕', '用户在上海工作', '用户养了一只叫豆豆的猫']
    const s = bm25('我喜欢吃什么', docs)
    expect(s.indexOf(Math.max(...s))).toBe(0)
    const s2 = bm25('我的猫叫什么名字', docs)
    expect(s2.indexOf(Math.max(...s2))).toBe(2)
  })

  it('bigram similarity detects near-duplicates', () => {
    expect(bigramSimilarity('用户喜欢吃草莓', '用户喜欢吃草莓。')).toBe(1)
    expect(bigramSimilarity('用户喜欢吃草莓', '用户在上海工作')).toBeLessThan(0.3)
  })
})

describe('MemoryStore', () => {
  it('adds, dedupes, searches, pins and deletes', () => {
    const store = new MemoryStore()
    store.add({ text: '用户喜欢吃草莓', type: 'preference', importance: 6 }, NOW)
    const dup = store.add({ text: '用户喜欢吃草莓！', importance: 8 }, NOW)
    expect(dup.merged).toBe(true)
    expect(store.size).toBe(1)
    expect(store.all()[0].importance).toBe(8)

    store.add({ text: '用户的生日是3月5日', importance: 10, pinned: true }, NOW)
    store.add({ text: '用户在上海做程序员', importance: 6 }, NOW)
    const hits = store.search('我喜欢吃什么来着', { now: NOW })
    expect(hits[0].item.text).toContain('草莓')
    // pinned memories are excluded from search (they are always in context via core())
    expect(hits.some((h) => h.item.pinned)).toBe(false)
    expect(store.core().map((m) => m.text)).toEqual(['用户的生日是3月5日'])

    const id = hits[0].item.id
    expect(store.remove(id)).toBe(true)
    expect(store.search('草莓', { now: NOW })).toHaveLength(0)
  })

  it('recency decays unless the memory is recalled', () => {
    const store = new MemoryStore()
    const a = store.add({ text: '用户喜欢猫', importance: 5 }, NOW - 60 * DAY).item
    const b = store.add({ text: '用户喜欢狗', importance: 5 }, NOW).item
    const [first] = store.search('用户喜欢什么动物', { now: NOW })
    expect(first.item.id).toBe(b.id)
    store.touch([a.id], NOW)
    const again = store.search('用户喜欢什么动物', { now: NOW })
    expect(again[0].recency).toBeCloseTo(1, 2)
  })

  it('uses embeddings when present', () => {
    const store = new MemoryStore()
    const a = store.add({ text: '用户周末常去爬山' }, NOW).item
    const b = store.add({ text: '用户讨厌下雨天' }, NOW).item
    store.setEmbedding(a.id, [1, 0, 0], 'm')
    store.setEmbedding(b.id, [0, 1, 0], 'm')
    // query shares no words with either memory; semantic vector points at "hiking"
    const hits = store.search('户外运动', { now: NOW, queryEmbedding: [0.9, 0.1, 0], embeddingModel: 'm' })
    expect(hits[0].item.id).toBe(a.id)
  })

  it('notifies on change and imports with dedupe', () => {
    let calls = 0
    const store = new MemoryStore([], () => calls++)
    store.add({ text: '用户喜欢蓝色' }, NOW)
    const r = store.importItems([{ text: '用户喜欢蓝色' }, { text: '用户怕黑' }, { text: '' }], NOW)
    expect(r).toEqual({ added: 1, merged: 1 })
    expect(calls).toBeGreaterThan(0)
  })
})

describe('extraction', () => {
  it('parses ops from fenced / chatty output', () => {
    const ops = parseMemoryOps('好的：\n```json\n{"ops":[{"op":"add","text":"用户喜欢草莓","type":"preference","importance":7},{"op":"delete","id":"m_1"},{"op":"bogus"}]}\n```')
    expect(ops).toEqual([
      { op: 'add', text: '用户喜欢草莓', type: 'preference', importance: 7 },
      { op: 'delete', id: 'm_1' }
    ])
    expect(parseMemoryOps('not json')).toEqual([])
  })

  it('only updates/deletes memories that were shown to the model', () => {
    const store = new MemoryStore()
    const shown = store.add({ text: '用户住在北京' }, NOW).item
    const hidden = store.add({ text: '用户有个妹妹' }, NOW).item
    const s = applyMemoryOps(
      store,
      [
        { op: 'update', id: shown.id, text: '用户搬到了上海' },
        { op: 'delete', id: hidden.id },
        { op: 'add', text: '用户下周要考英语', importance: 6 }
      ],
      new Set([shown.id]),
      NOW
    )
    expect(s.updated).toEqual([shown.id])
    expect(s.deleted).toEqual([])
    expect(s.added).toHaveLength(1)
    expect(store.get(shown.id)?.text).toBe('用户搬到了上海')
    expect(store.get(hidden.id)).toBeDefined()
  })

  it('protects hand-pinned memories from model edits', () => {
    const store = new MemoryStore()
    const core = store.add({ text: '用户叫小明', pinned: true, source: 'user' }, NOW).item
    applyMemoryOps(store, [{ op: 'delete', id: core.id }], new Set([core.id]), NOW)
    expect(store.get(core.id)).toBeDefined()
  })

  it('builds a prompt that lists related memory ids', () => {
    const msgs = buildExtractionMessages({
      petName: '团子',
      userCallName: '主人',
      turns: [{ role: 'user', content: '我搬家了' }],
      related: [{ id: 'm_x', text: '用户住在北京' } as never],
      now: NOW
    })
    expect(msgs[0].content).toContain('m_x: 用户住在北京')
    expect(msgs[1].content).toContain('用户：我搬家了')
  })

  it('detects explicit remember requests but not questions', () => {
    expect(detectExplicitRemember('记住我喜欢吃草莓')).toBe('我喜欢吃草莓')
    expect(detectExplicitRemember('你要记住，我的生日是3月5号！')).toBe('我的生日是3月5号')
    expect(detectExplicitRemember('记得我喜欢什么吗？')).toBeNull()
    expect(detectExplicitRemember('你记得我喜欢什么吗')).toBeNull()
    expect(detectExplicitRemember('今天好累')).toBeNull()
    expect(toThirdPerson('我的生日是3月5号')).toBe('用户的生日是3月5号')
    expect(toThirdPerson('我喜欢猫，我也喜欢狗')).toBe('用户喜欢猫，用户也喜欢狗')
  })

  it('parses diary JSON and plain text', () => {
    expect(parseDiary('{"diary":"今天吃了饭团","insights":["用户最近很忙", 3],"summary":"2026-11-03 用户说工作忙"}')).toEqual({
      diary: '今天吃了饭团',
      insights: ['用户最近很忙'],
      summary: '2026-11-03 用户说工作忙'
    })
    expect(parseDiary('今天主人陪我玩了')).toEqual({ diary: '今天主人陪我玩了', insights: [], summary: '' })
  })
})
