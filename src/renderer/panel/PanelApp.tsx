import { useEffect, useState } from 'react'
import type { Snapshot } from '../../core/ipc'
import { api } from '../shared/api'
import { AppearanceTab } from './tabs/AppearanceTab'
import { ChatTab } from './tabs/ChatTab'
import { DiaryTab } from './tabs/DiaryTab'
import { MemoryTab } from './tabs/MemoryTab'
import { PersonaTab } from './tabs/PersonaTab'
import { SettingsTab } from './tabs/SettingsTab'
import { ShopTab } from './tabs/ShopTab'
import { StatusTab } from './tabs/StatusTab'
import { WelcomeTab } from './tabs/WelcomeTab'
import { ToastProvider } from './ui'

const TABS = [
  { id: 'welcome', label: '开始设置', icon: '✨' },
  { id: 'chat', label: '聊天', icon: '💬' },
  { id: 'status', label: '状态', icon: '📊' },
  { id: 'shop', label: '商店', icon: '🛒' },
  { id: 'memory', label: '记忆', icon: '🧠' },
  { id: 'diary', label: '日记', icon: '📔' },
  { id: 'appearance', label: '形象', icon: '🎨' },
  { id: 'persona', label: '人设', icon: '🎭' },
  { id: 'settings', label: '设置', icon: '⚙️' }
] as const
export type TabId = (typeof TABS)[number]['id']

export function PanelApp() {
  const initial = new URLSearchParams(location.search).get('tab') as TabId | null
  const [tab, setTab] = useState<TabId>(initial && TABS.some((t) => t.id === initial) ? initial : 'chat')
  const [snap, setSnap] = useState<Snapshot | null>(null)

  useEffect(() => {
    void api.getSnapshot().then(setSnap)
    const off = [
      api.on('game:update', (p) => setSnap((s) => (s ? { ...s, game: p.game, conditions: p.conditions } : s))),
      api.on('settings:update', (settings) => setSnap((s) => (s ? { ...s, settings } : s))),
      api.on('persona:update', (persona) => setSnap((s) => (s ? { ...s, persona } : s))),
      api.on('packs:update', (packs) => setSnap((s) => (s ? { ...s, packs } : s))),
      api.on('memory:changed', ({ count }) => setSnap((s) => (s ? { ...s, memoryCount: count } : s))),
      api.on('panel:tab', ({ tab }) => TABS.some((t) => t.id === tab) && setTab(tab as TabId))
    ]
    return () => off.forEach((f) => f())
  }, [])

  const refresh = () => void api.getSnapshot().then(setSnap)
  useEffect(refresh, [tab])

  if (!snap) return <div className="loading">加载中…</div>
  return (
    <ToastProvider>
      <div className="layout">
        <nav className="sidebar">
          <div className="brand">
            <span className="brand-name">{snap.persona.name}</span>
            <span className="muted">SoulPet 灵宠 v{snap.version}</span>
          </div>
          {TABS.filter((t) => t.id !== 'welcome' || !snap.settings.setupDone).map((t) => (
            <button key={t.id} className={`nav ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
              <span className="nav-icon">{t.icon}</span>
              {t.label}
              {t.id === 'memory' && <span className="badge">{snap.memoryCount}</span>}
            </button>
          ))}
          <div className="sidebar-foot muted">
            今日 token：{(snap.usageToday.input + snap.usageToday.output).toLocaleString()}
            <br />
            请求 {snap.usageToday.requests} 次
          </div>
        </nav>
        <main className="content">
          {tab === 'welcome' && (
            <WelcomeTab
              snap={snap}
              onDone={() => {
                setTab('chat')
                refresh()
              }}
            />
          )}
          {tab === 'chat' && <ChatTab snap={snap} />}
          {tab === 'status' && <StatusTab snap={snap} />}
          {tab === 'shop' && <ShopTab snap={snap} />}
          {tab === 'memory' && <MemoryTab snap={snap} />}
          {tab === 'diary' && <DiaryTab snap={snap} />}
          {tab === 'appearance' && <AppearanceTab snap={snap} />}
          {tab === 'persona' && <PersonaTab snap={snap} />}
          {tab === 'settings' && <SettingsTab snap={snap} onRefresh={refresh} />}
        </main>
      </div>
    </ToastProvider>
  )
}
