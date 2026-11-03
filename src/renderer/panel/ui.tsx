import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

export function Section({ title, desc, children, actions }: { title: string; desc?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h3>{title}</h3>
          {desc && <p className="muted">{desc}</p>}
        </div>
        {actions && <div className="row">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <div className="field-body">
        {children}
        {hint && <span className="hint">{hint}</span>}
      </div>
    </label>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <span className="toggle-wrap">
      <button type="button" role="switch" aria-checked={checked} className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
        <span />
      </button>
      {label && <span>{label}</span>}
    </span>
  )
}

export function Bar({ value, max = 100, color }: { value: number; max?: number; color: string }) {
  return (
    <div className="bar">
      <div style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%`, background: color }} />
    </div>
  )
}

type ToastFn = (msg: string, kind?: 'ok' | 'err') => void
const ToastCtx = createContext<ToastFn>(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Array<{ id: number; msg: string; kind: 'ok' | 'err' }>>([])
  const push = useCallback<ToastFn>((msg, kind = 'ok') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t.slice(-3), { id, msg, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export function fmtTime(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return d.toDateString() === today.toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`
}

/**
 * Text / number input that edits locally and commits on blur or Enter, so typing never
 * round-trips through the main process (no lost characters or caret jumps).
 */
export function CommitInput({
  value,
  onCommit,
  type = 'text',
  placeholder,
  min,
  max,
  step,
  className
}: {
  value: string | number
  onCommit: (v: string) => void
  type?: 'text' | 'number'
  placeholder?: string
  min?: number
  max?: number
  step?: number
  className?: string
}) {
  const [draft, setDraft] = useState(String(value))
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setDraft(String(value))
  }, [value, focused])
  const commit = () => {
    const v = draft.trim()
    if (type === 'number') {
      const n = Number(v)
      if (v === '' || !Number.isFinite(n)) return setDraft(String(value)) // ignore empty / invalid
      const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n))
      if (clamped !== Number(value)) onCommit(String(clamped))
      setDraft(String(clamped))
      return
    }
    if (v !== String(value)) onCommit(v)
  }
  return (
    <input
      className={className}
      type={type}
      value={draft}
      placeholder={placeholder}
      min={min}
      max={max}
      step={step}
      onFocus={() => setFocused(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setFocused(false)
        commit()
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}
