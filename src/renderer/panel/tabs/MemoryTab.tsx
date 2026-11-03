import { useEffect, useMemo, useState } from 'react'
import type { MemoryItemPublic, ScoredMemoryPublic, Snapshot } from '../../../core/ipc'
import { MEMORY_TYPE_LABEL, type MemoryType } from '../../../core/memory/types'
import { api } from '../../shared/api'
import { fmtTime, Section, useToast } from '../ui'

const TYPES = Object.keys(MEMORY_TYPE_LABEL) as MemoryType[]

function MemoryRow({ m, onChange, score }: { m: MemoryItemPublic; onChange: () => void; score?: number }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(m.text)
  const toast = useToast()
  const save = async () => {
    await api.memoryUpdate(m.id, { text })
    setEditing(false)
    onChange()
  }
  return (
    <div className={`mem ${m.pinned ? 'pinned' : ''}`}>
      <div className="mem-main">
        {editing ? (
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} autoFocus />
        ) : (
          <div className="mem-text">{m.text}</div>
        )}
        <div className="mem-meta muted small">
          <span className={`tag t-${m.type}`}>{MEMORY_TYPE_LABEL[m.type]}</span>
          <span title="重要度">★{m.importance}</span>
          <span>{m.source === 'auto' ? '自动记住' : m.source === 'explicit' ? '你让它记住' : m.source === 'diary' ? '日记感悟' : m.source === 'import' ? '导入' : '手动添加'}</span>
          <span>更新于 {fmtTime(m.updatedAt)}</span>
          <span>想起 {m.accessCount} 次</span>
          {m.hasEmbedding && <span title="已生成向量">🧭</span>}
          {score !== undefined && <span>匹配度 {score.toFixed(2)}</span>}
        </div>
      </div>
      <div className="mem-actions">
        {editing ? (
          <>
            <button className="btn small primary" onClick={() => void save()}>保存</button>
            <button className="btn small ghost" onClick={() => (setEditing(false), setText(m.text))}>取消</button>
          </>
        ) : (
          <>
            <button
              className="btn small ghost"
              title={m.pinned ? '取消置顶' : '置顶为核心记忆（每次聊天都会带上）'}
              onClick={async () => {
                await api.memoryUpdate(m.id, { pinned: !m.pinned })
                onChange()
              }}
            >
              {m.pinned ? '📌 已置顶' : '置顶'}
            </button>
            <select
              className="small"
              value={m.importance}
              title="重要度"
              onChange={async (e) => {
                await api.memoryUpdate(m.id, { importance: Number(e.target.value) })
                onChange()
              }}
            >
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  ★{n}
                </option>
              ))}
            </select>
            <button className="btn small ghost" onClick={() => setEditing(true)}>编辑</button>
            <button
              className="btn small danger"
              onClick={async () => {
                if (!confirm(`忘掉这条记忆？\n${m.text}`)) return
                await api.memoryDelete(m.id)
                toast('已忘掉')
                onChange()
              }}
            >
              忘掉
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export function MemoryTab({ snap }: { snap: Snapshot }) {
  const [items, setItems] = useState<MemoryItemPublic[]>([])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ScoredMemoryPublic[] | null>(null)
  const [filter, setFilter] = useState<MemoryType | 'all' | 'pinned'>('all')
  const [newText, setNewText] = useState('')
  const [newType, setNewType] = useState<MemoryType>('fact')
  const toast = useToast()

  const reload = () => void api.memoryList().then(setItems)
  useEffect(() => {
    reload()
    return api.on('memory:changed', reload)
  }, [])

  useEffect(() => {
    if (!query.trim()) return setResults(null)
    const t = setTimeout(() => void api.memorySearch(query).then(setResults), 200)
    return () => clearTimeout(t)
  }, [query, items])

  const shown = useMemo(
    () => items.filter((m) => (filter === 'all' ? true : filter === 'pinned' ? m.pinned : m.type === filter)),
    [items, filter]
  )

  return (
    <div className="stack">
      <Section
        title={`${snap.persona.name}的记忆库`}
        desc={
          <>
            共 {items.length} 条，全部只保存在你的电脑上。聊天时会按「相关度 + 新近度 + 重要度」挑出最相关的几条带给模型；置顶的核心记忆每次都会带上。
            {snap.settings.embedding.enabled ? ' 已开启向量检索。' : ' 当前使用关键词检索（可在设置中开启向量记忆）。'}
          </>
        }
        actions={
          <>
            <button
              className="btn ghost"
              onClick={async () => {
                const p = await api.memoryExport()
                if (p) toast(`已导出到 ${p}`)
              }}
            >
              导出
            </button>
            <button
              className="btn ghost"
              onClick={async () => {
                const r = await api.memoryImport()
                if (r) toast(`导入完成：新增 ${r.added}，合并 ${r.merged}`)
                reload()
              }}
            >
              导入
            </button>
          </>
        }
      >
        <div className="row add-mem">
          <input value={newText} placeholder="手动添加一条记忆，例如：用户的生日是 3 月 5 日" onChange={(e) => setNewText(e.target.value)} />
          <select value={newType} onChange={(e) => setNewType(e.target.value as MemoryType)}>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {MEMORY_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          <button
            className="btn primary"
            disabled={!newText.trim()}
            onClick={async () => {
              await api.memoryAdd({ text: newText, type: newType, importance: 7 })
              setNewText('')
              reload()
              toast('记住啦')
            }}
          >
            添加
          </button>
        </div>
        <div className="row filters">
          <input className="search" value={query} placeholder="🔍 搜索记忆（试试“我喜欢吃什么”）" onChange={(e) => setQuery(e.target.value)} />
          {!results && (
            <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
              <option value="all">全部类型</option>
              <option value="pinned">📌 核心记忆</option>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {MEMORY_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="mem-list">
          {results
            ? results.length
              ? results.map((r) => <MemoryRow key={r.item.id} m={r.item} score={r.score} onChange={reload} />)
              : <div className="empty">没有找到相关记忆</div>
            : shown.length
              ? shown.map((m) => <MemoryRow key={m.id} m={m} onChange={reload} />)
              : <div className="empty">还没有记忆。和它聊聊你自己，或者说“记住……”。</div>}
        </div>
      </Section>
    </div>
  )
}
