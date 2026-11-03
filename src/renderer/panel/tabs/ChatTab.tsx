import { useEffect, useRef, useState } from 'react'
import type { Snapshot, StoredMessage } from '../../../core/ipc'
import { api } from '../../shared/api'
import { fmtTime, useToast } from '../ui'

export function ChatTab({ snap }: { snap: Snapshot }) {
  const [messages, setMessages] = useState<StoredMessage[]>([])
  const [streaming, setStreaming] = useState<{ id: string; text: string } | null>(null)
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const toast = useToast()
  const active = snap.settings.providers.find((p) => p.id === snap.settings.activeProviderId)

  useEffect(() => {
    void api.chatHistory(200).then(setMessages)
    const off = [
      api.on('chat:start', (p) => {
        setMessages((m) => [...m, { id: `u-${p.id}`, role: 'user', content: p.userText, ts: Date.now() }])
        setStreaming({ id: p.id, text: '' })
      }),
      api.on('chat:delta', (p) => setStreaming((s) => (s && s.id === p.id ? { ...s, text: s.text + p.delta } : s))),
      api.on('chat:done', (p) => {
        setStreaming(null)
        setMessages((m) => (m.some((x) => x.id === p.message.id) ? m : [...m, p.message]))
      }),
      api.on('chat:error', (p) => {
        setStreaming(null)
        setMessages((m) => [...m, { id: p.id, role: 'assistant', content: p.message, ts: Date.now(), error: true }])
      }),
      api.on('pet:say', () => void api.chatHistory(200).then(setMessages))
    ]
    return () => off.forEach((f) => f())
  }, [])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages, streaming])

  const send = async () => {
    const text = draft.trim()
    if (!text || streaming) return
    setDraft('')
    const r = await api.chatSend(text)
    if (!r.ok && r.error) {
      setDraft((d) => d || text) // give the text back so it is not lost
      toast(r.error, 'err')
    }
  }

  return (
    <div className="chat">
      <div className="chat-head">
        <div>
          <h2>和{snap.persona.name}聊天</h2>
          <span className="muted">
            {active ? `${active.name} · ${active.model}` : '未选择模型'}
            {active && !active.hasKey && !active.noKey && <b className="warn-text"> · 还没填 API Key</b>}
          </span>
        </div>
        <div className="row">
          {streaming && (
            <button className="btn" onClick={() => void api.chatAbort()}>
              停止
            </button>
          )}
          <button
            className="btn ghost"
            onClick={async () => {
              if (!confirm('清空聊天记录？（不会删除记忆库）')) return
              await api.chatClear()
              setMessages([])
            }}
          >
            清空记录
          </button>
        </div>
      </div>
      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && !streaming && <div className="empty">还没有聊过天。说点什么吧，它会记住你们聊过的重要的事。</div>}
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role} ${m.error ? 'error' : ''} ${m.proactive ? 'proactive' : ''}`}>
            <div className="msg-bubble">{m.content}</div>
            <div className="msg-meta">
              {m.proactive && '主动 · '}
              {fmtTime(m.ts)}
            </div>
          </div>
        ))}
        {streaming && (
          <div className="msg assistant">
            <div className="msg-bubble">{streaming.text || <span className="muted">思考中…</span>}</div>
          </div>
        )}
      </div>
      <div className="chat-input">
        <textarea
          value={draft}
          placeholder={`对${snap.persona.name}说…（Enter 发送，Shift+Enter 换行）`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void send()
            }
          }}
        />
        <button className="btn primary" onClick={() => void send()} disabled={!draft.trim() || !!streaming}>
          发送
        </button>
      </div>
    </div>
  )
}
