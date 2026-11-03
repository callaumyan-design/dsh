import { useEffect, useState } from 'react'
import type { Snapshot } from '../../../core/ipc'
import { describeDue, type Repeat, type TasksState } from '../../../core/tasks'
import { api } from '../../shared/api'
import { Section, useToast } from '../ui'

function localInputValue(ts: number): string {
  const d = new Date(ts - new Date(ts).getTimezoneOffset() * 60_000)
  return d.toISOString().slice(0, 16)
}

function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

export function TasksTab({ snap }: { snap: Snapshot }) {
  const [tasks, setTasks] = useState<TasksState>(snap.tasks)
  const [rText, setRText] = useState('')
  const [rWhen, setRWhen] = useState(localInputValue(Date.now() + 30 * 60_000))
  const [rRepeat, setRRepeat] = useState<Repeat>('none')
  const [todo, setTodo] = useState('')
  const toast = useToast()
  const now = useNow()
  useEffect(() => api.on('tasks:update', setTasks), [])
  useEffect(() => setTasks(snap.tasks), [snap.tasks])

  const focus = tasks.focus && tasks.focus.endsAt > now ? tasks.focus : null
  const remain = focus ? Math.max(0, focus.endsAt - now) : 0
  const mm = String(Math.floor(remain / 60_000)).padStart(2, '0')
  const ss = String(Math.floor((remain % 60_000) / 1000)).padStart(2, '0')
  const progress = focus ? 1 - remain / (focus.minutes * 60_000) : 0
  const open = tasks.reminders.filter((r) => !r.done)
  const done = tasks.reminders.filter((r) => r.done).slice(-5)

  return (
    <div className="stack">
      <Section title="🍅 一起专注" desc={`番茄钟期间${snap.persona.name}会安静地陪你工作，不会主动打扰；完成后获得金币、经验和好感。`}>
        {focus ? (
          <div className="focus-box">
            <div className="focus-time">
              {mm}:{ss}
            </div>
            <div className="bar">
              <div style={{ width: `${progress * 100}%`, background: '#ff6f61' }} />
            </div>
            <div className="row">
              <span className="muted">共 {focus.minutes} 分钟</span>
              <button className="btn danger" onClick={() => void api.focusStop()}>
                提前结束
              </button>
            </div>
          </div>
        ) : (
          <div className="row">
            {[15, 25, 45, 60].map((m) => (
              <button key={m} className="btn" onClick={() => void api.focusStart(m)}>
                {m} 分钟
              </button>
            ))}
            <span className="muted small">累计专注 {snap.game.totals.focusMinutes ?? 0} 分钟</span>
          </div>
        )}
      </Section>

      <Section title="⏰ 提醒" desc={`也可以直接对${snap.persona.name}说“20 分钟后提醒我喝水”、“每天 8 点叫我吃早饭”。到点时它会冒泡并弹出系统通知。`}>
        <div className="row">
          <input className="grow" value={rText} placeholder="提醒内容，例如：喝水" onChange={(e) => setRText(e.target.value)} />
          <input type="datetime-local" value={rWhen} onChange={(e) => setRWhen(e.target.value)} />
          <select value={rRepeat} onChange={(e) => setRRepeat(e.target.value as Repeat)}>
            <option value="none">一次</option>
            <option value="daily">每天</option>
            <option value="weekly">每周</option>
          </select>
          <button
            className="btn primary"
            disabled={!rText.trim() || !rWhen}
            onClick={async () => {
              const dueAt = new Date(rWhen).getTime()
              if (Number.isNaN(dueAt)) return toast('时间格式不对', 'err')
              setTasks(await api.tasksAddReminder({ text: rText, dueAt, repeat: rRepeat }))
              setRText('')
              toast(`好的，${describeDue(dueAt, Date.now())}提醒你`)
            }}
          >
            添加
          </button>
        </div>
        <div className="task-list">
          {open.length === 0 && <div className="empty">没有待提醒的事</div>}
          {open.map((r) => (
            <div key={r.id} className="task">
              <span className="task-when">{describeDue(r.dueAt, now)}</span>
              <span className="grow">
                {r.text}
                {r.repeat !== 'none' && <span className="pill">{r.repeat === 'daily' ? '每天' : '每周'}</span>}
                {r.source === 'ai' && <span className="muted small"> · 聊天中设置</span>}
              </span>
              <button className="btn small ghost" onClick={async () => setTasks(await api.tasksEdit({ kind: 'deleteReminder', id: r.id }))}>
                删除
              </button>
            </div>
          ))}
          {done.length > 0 && <div className="muted small">最近已提醒：{done.map((r) => r.text).join('、')}</div>}
        </div>
      </Section>

      <Section
        title="📝 待办"
        actions={
          tasks.todos.some((t) => t.done) && (
            <button className="btn ghost small" onClick={async () => setTasks(await api.tasksEdit({ kind: 'clearDoneTodos' }))}>
              清除已完成
            </button>
          )
        }
      >
        <div className="row">
          <input
            className="grow"
            value={todo}
            placeholder="新的待办，回车添加"
            onChange={(e) => setTodo(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === 'Enter' && todo.trim() && !e.nativeEvent.isComposing) {
                setTasks(await api.tasksAddTodo(todo))
                setTodo('')
              }
            }}
          />
        </div>
        <div className="task-list">
          {tasks.todos.length === 0 && <div className="empty">没有待办</div>}
          {tasks.todos.map((t) => (
            <label key={t.id} className={`task ${t.done ? 'done' : ''}`}>
              <input type="checkbox" checked={t.done} onChange={async () => setTasks(await api.tasksEdit({ kind: 'toggleTodo', id: t.id }))} />
              <span className="grow">{t.text}</span>
              <button className="btn small ghost" onClick={async (e) => (e.preventDefault(), setTasks(await api.tasksEdit({ kind: 'deleteTodo', id: t.id })))}>
                删除
              </button>
            </label>
          ))}
        </div>
      </Section>
    </div>
  )
}
