import { useEffect, useState } from 'react'
import { PROVIDER_PRESETS } from '../../../core/ai/providers'
import { stageOf } from '../../../core/game/engine'
import type { Snapshot, TestResult } from '../../../core/ipc'
import { api } from '../../shared/api'
import { PetView } from '../../shared/PetView'
import { useToast } from '../ui'

const COLORS = ['#8fd3ff', '#ffb3c7', '#b8f2a6', '#ffe08a', '#c9b8ff', '#ffc89a']
const STEPS = ['起名字', '接上大脑', '选形象', '完成']

export function WelcomeTab({ snap, onDone }: { snap: Snapshot; onDone: () => void }) {
  const [step, setStep] = useState(0)
  const [name, setName] = useState(snap.persona.name)
  const [callName, setCallName] = useState(snap.persona.userCallName)
  const [key, setKey] = useState('')
  const [test, setTest] = useState<TestResult | null>(null)
  const [testing, setTesting] = useState(false)
  const toast = useToast()
  const s = snap.settings
  const active = s.providers.find((p) => p.id === s.activeProviderId)
  const preset = PROVIDER_PRESETS.find((p) => p.id === active?.id)
  const ready = !!active && (active.hasKey || !!active.noKey)
  const a = s.appearance
  useEffect(() => setTest(null), [s.activeProviderId])

  const saveNames = async () => {
    const old = snap.persona.name
    const n = name.trim() || old
    await api.personaUpdate({
      name: n,
      userCallName: callName.trim() || snap.persona.userCallName,
      greeting: snap.persona.greeting.split(old).join(n)
    })
  }

  const runTest = async () => {
    if (!active) return
    if (key.trim()) await api.setApiKey(active.id, key.trim())
    setKey('')
    setTesting(true)
    const r = await api.testProvider(active.id)
    setTesting(false)
    setTest(r)
  }

  const cards = [
    ...(active && !preset ? [{ id: active.id, name: active.name, note: `${active.baseURL} · ${active.model}` }] : []),
    ...PROVIDER_PRESETS.map((p) => ({ id: p.id, name: p.name, note: p.note ?? p.model }))
  ]

  return (
    <div className="welcome">
      <div className="steps">
        {STEPS.map((label, i) => (
          <div key={label} className={`step ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`}>
            <span>{i < step ? '✓' : i + 1}</span>
            {label}
          </div>
        ))}
      </div>

      {step === 0 && (
        <div className="card welcome-card">
          <div className="welcome-pet">
            <PetView pack={snap.packs[0]} state="wave" emotion="happy" appearance={a} stage="baby" width={170} height={150} />
          </div>
          <h2>你好，我是你的新桌宠！</h2>
          <p className="muted">我会住在你的桌面上，需要你照顾，也会和你聊天，还会记住你告诉我的事。先给我起个名字吧~</p>
          <label className="field">
            <span className="field-label">它的名字</span>
            <div className="field-body">
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={16} />
            </div>
          </label>
          <label className="field">
            <span className="field-label">它怎么称呼你</span>
            <div className="field-body">
              <input value={callName} onChange={(e) => setCallName(e.target.value)} maxLength={16} placeholder="主人、你的名字、昵称……" />
            </div>
          </label>
          <div className="row end">
            <button
              className="btn primary"
              onClick={async () => {
                await saveNames()
                setStep(1)
              }}
            >
              下一步
            </button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="card welcome-card">
          <h2>给{name}接上“大脑”</h2>
          <p className="muted">选一个大模型服务商，填入你自己的 API Key（加密保存在本机）。不想现在填也可以跳过，先只玩养成。</p>
          <div className="provider-cards">
            {cards.map((c) => (
              <button key={c.id} className={`provider-card ${c.id === s.activeProviderId ? 'active' : ''}`} onClick={() => void api.settingsUpdate({ activeProviderId: c.id })}>
                <b>{c.name}</b>
                <span className="muted small">{c.note}</span>
              </button>
            ))}
          </div>
          {active && (
            <div className="key-box">
              {active.noKey ? (
                <p>这个服务不需要 API Key。{active.id === 'ollama' && '请先安装 Ollama 并下载模型。'}</p>
              ) : (
                <div className="row">
                  <input
                    type="password"
                    className="grow"
                    value={key}
                    placeholder={active.hasKey ? '已保存 Key（留空不修改）' : `粘贴 ${active.name} 的 API Key`}
                    onChange={(e) => setKey(e.target.value)}
                  />
                  {preset?.keyUrl && (
                    <button className="btn ghost" onClick={() => void api.openExternal(preset.keyUrl!)}>
                      去获取 Key
                    </button>
                  )}
                </div>
              )}
              <div className="row">
                <button className="btn" disabled={testing || (!key.trim() && !ready)} onClick={() => void runTest()}>
                  {testing ? '连接中…' : '保存并测试'}
                </button>
                {test && <span className={test.ok ? 'good-text' : 'bad-text'}>{test.ok ? `✓ ${test.message}` : `✗ ${test.message}`}</span>}
                {!test && ready && <span className="good-text">✓ 已配置</span>}
              </div>
            </div>
          )}
          <div className="row between">
            <button className="btn ghost" onClick={() => setStep(0)}>
              上一步
            </button>
            <span className="row">
              {!ready && (
                <button className="btn ghost" onClick={() => setStep(2)}>
                  先跳过
                </button>
              )}
              <button
                className="btn primary"
                disabled={!ready && !key.trim()}
                onClick={async () => {
                  if (key.trim() && active) {
                    await api.setApiKey(active.id, key.trim())
                    setKey('')
                  }
                  setStep(2)
                }}
              >
                下一步
              </button>
            </span>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="card welcome-card">
          <h2>选一个形象</h2>
          <p className="muted">以后可以在“形象”页面里换，也可以放入 Codex 格式或自己做的形象包。</p>
          <div className="pack-grid">
            {snap.packs.map((p) => (
              <button key={p.id} className={`pack ${p.id === a.packId ? 'active' : ''}`} onClick={() => void api.packSelect(p.id)}>
                <div className="pack-preview">
                  <PetView pack={p} state="idle" emotion={null} appearance={a} stage={stageOf(snap.game.level)} width={110} height={110 * (p.height / p.width)} />
                </div>
                <div className="pack-name">{p.name}</div>
              </button>
            ))}
          </div>
          {snap.packs.find((p) => p.id === a.packId)?.kind === 'builtin' && (
            <div className="row" style={{ marginTop: 12 }}>
              <span className="muted">颜色：</span>
              {COLORS.map((c) => (
                <button
                  key={c}
                  className={`swatch ${a.blobColor === c ? 'active' : ''}`}
                  style={{ background: c }}
                  aria-label={c}
                  onClick={() => void api.settingsUpdate({ appearance: { ...a, blobColor: c } })}
                />
              ))}
            </div>
          )}
          <div className="row between">
            <button className="btn ghost" onClick={() => setStep(1)}>
              上一步
            </button>
            <button className="btn primary" onClick={() => setStep(3)}>
              下一步
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="card welcome-card">
          <h2>准备好啦！</h2>
          <ul className="tips">
            <li>
              <b>单击</b> {name}：摸摸它（加好感）
            </li>
            <li>
              <b>双击</b>，或者按 <code>{s.app.hotkey.replace('CommandOrControl', snap.platform === 'darwin' ? 'Cmd' : 'Ctrl')}</code>：和它聊天
            </li>
            <li>
              <b>拖动</b>：把它拎起来，松手会掉下去
            </li>
            <li>
              <b>右键</b>：喂食、洗澡、玩耍、打工、打开面板
            </li>
            <li>
              <b>鼠标停在它身上</b>：看它饿不饿、困不困
            </li>
            <li>
              对它说“<b>记住……</b>”，它就会记下来；在“记忆”页面可以看到它记住的所有事
            </li>
          </ul>
          <div className="row between">
            <button className="btn ghost" onClick={() => setStep(2)}>
              上一步
            </button>
            <button
              className="btn primary"
              onClick={async () => {
                await api.completeSetup()
                toast(`${name}来到你的桌面啦`)
                onDone()
              }}
            >
              开始陪伴
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
