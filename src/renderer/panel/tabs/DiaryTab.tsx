import { useEffect, useState } from 'react'
import type { Snapshot } from '../../../core/ipc'
import type { DiaryEntry } from '../../../core/memory/types'
import { api } from '../../shared/api'
import { Section, useToast } from '../ui'

export function DiaryTab({ snap }: { snap: Snapshot }) {
  const [entries, setEntries] = useState<DiaryEntry[]>([])
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  useEffect(() => void api.diaryList().then(setEntries), [])

  return (
    <Section
      title={`${snap.persona.name}的日记`}
      desc="每天第一次启动时，它会把前一天的事写成日记，并从中提炼对你的新认识（写入记忆库）。也可以手动让它写今天的。"
      actions={
        <button
          className="btn primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              const r = await api.diaryGenerate()
              if (r.ok) {
                toast('写好啦')
                setEntries(await api.diaryList())
              } else toast(r.error ?? '写日记失败', 'err')
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? '正在写…' : '写今天的日记'}
        </button>
      }
    >
      {entries.length === 0 && <div className="empty">还没有日记。</div>}
      <div className="diary-list">
        {entries.map((e) => (
          <article key={e.date} className="diary">
            <h4>📔 {e.date}</h4>
            <p>{e.text}</p>
            {e.insights.length > 0 && (
              <div className="insights">
                {e.insights.map((i) => (
                  <div key={i} className="muted small">
                    💡 {i}
                  </div>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>
    </Section>
  )
}
