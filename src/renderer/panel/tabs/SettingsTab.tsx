import { useEffect, useState } from 'react'
import { EMBEDDING_PRESETS, PROVIDER_PRESETS } from '../../../core/ai/providers'
import { STT_PRESETS } from '../../../core/ai/stt'
import type { ProviderConfig } from '../../../core/ai/types'
import type { PublicProvider, Snapshot } from '../../../core/ipc'
import type { Settings } from '../../../core/settings'
import { api } from '../../shared/api'
import { speak } from '../../shared/speech'
import { Field, Section, Toggle, useToast } from '../ui'

function ProviderEditor({ provider, isActive, onSaved }: { provider: PublicProvider; isActive: boolean; onSaved: () => void }) {
  const [cfg, setCfg] = useState<ProviderConfig>(provider)
  const [key, setKey] = useState('')
  const [testing, setTesting] = useState(false)
  const toast = useToast()
  const preset = PROVIDER_PRESETS.find((p) => p.id === provider.id)
  useEffect(() => {
    const { hasKey: _h, ...rest } = provider
    setCfg(rest)
    setKey('')
  }, [provider])
  const dirty = JSON.stringify(cfg) !== JSON.stringify((({ hasKey: _h, ...r }) => r)(provider))

  const save = async () => {
    await api.providerUpsert(cfg)
    if (key.trim()) await api.setApiKey(cfg.id, key.trim())
    setKey('')
    toast('已保存')
    onSaved()
  }

  return (
    <div className="provider-editor">
      {preset?.note && <p className="note">{preset.note}</p>}
      <Field label="名称">
        <input value={cfg.name} onChange={(e) => setCfg({ ...cfg, name: e.target.value })} />
      </Field>
      <Field label="协议" hint="绝大多数国内外服务商都兼容 OpenAI 协议">
        <select value={cfg.kind} onChange={(e) => setCfg({ ...cfg, kind: e.target.value as ProviderConfig['kind'] })}>
          <option value="openai">OpenAI 兼容</option>
          <option value="anthropic">Anthropic（Claude）</option>
        </select>
      </Field>
      <Field label="接口地址 Base URL">
        <input value={cfg.baseURL} onChange={(e) => setCfg({ ...cfg, baseURL: e.target.value })} />
      </Field>
      <Field label="模型">
        <input list={`models-${cfg.id}`} value={cfg.model} onChange={(e) => setCfg({ ...cfg, model: e.target.value })} />
        <datalist id={`models-${cfg.id}`}>
          {(preset?.models ?? []).map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </Field>
      {!cfg.noKey && (
        <Field
          label="API Key"
          hint={
            <>
              {provider.hasKey ? '✅ 已保存（加密存储在本机）。留空表示不修改。' : '还没有填写。'}
              {preset?.keyUrl && (
                <a href="#" onClick={(e) => (e.preventDefault(), void api.openExternal(preset.keyUrl!))}>
                  {' '}
                  去获取 Key →
                </a>
              )}
            </>
          }
        >
          <input type="password" value={key} placeholder={provider.hasKey ? '••••••••（已保存）' : 'sk-...'} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
        </Field>
      )}
      {cfg.kind === 'openai' ? (
        <Field label="温度 temperature" hint="越高越活泼，留空用服务商默认值">
          <input
            type="number"
            step={0.1}
            min={0}
            max={2}
            value={cfg.temperature ?? ''}
            onChange={(e) => setCfg({ ...cfg, temperature: e.target.value === '' ? undefined : Number(e.target.value) })}
          />
        </Field>
      ) : (
        <>
          <Field label="思考力度 effort" hint="闲聊用 low 就够了，又快又省；想让它更认真可以调高">
            <select value={cfg.effort ?? ''} onChange={(e) => setCfg({ ...cfg, effort: e.target.value as ProviderConfig['effort'] })}>
              <option value="">默认</option>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </Field>
          <Field label="拒答时自动换模型" hint="官方接口上，遇到安全拒答会由服务端自动用备用模型重试">
            <Toggle checked={cfg.useFallbacks !== false} onChange={(v) => setCfg({ ...cfg, useFallbacks: v })} />
          </Field>
        </>
      )}
      <Field label="不需要 Key">
        <Toggle checked={!!cfg.noKey} onChange={(v) => setCfg({ ...cfg, noKey: v })} label="本地模型（如 Ollama）可以打开" />
      </Field>
      <div className="row">
        <button className="btn primary" disabled={!dirty && !key.trim()} onClick={() => void save()}>
          保存
        </button>
        <button
          className="btn"
          disabled={testing}
          onClick={async () => {
            if (dirty || key.trim()) await save()
            setTesting(true)
            const r = await api.testProvider(cfg.id)
            setTesting(false)
            toast(r.ok ? `${r.message}（${r.latencyMs}ms）` : r.message, r.ok ? 'ok' : 'err')
          }}
        >
          {testing ? '测试中…' : '测试连接'}
        </button>
        {!isActive && (
          <button
            className="btn"
            onClick={async () => {
              await api.settingsUpdate({ activeProviderId: cfg.id })
              toast(`已切换到 ${cfg.name}`)
              onSaved()
            }}
          >
            设为聊天模型
          </button>
        )}
        {!preset && (
          <button
            className="btn danger"
            onClick={async () => {
              if (!confirm(`删除 ${cfg.name}？`)) return
              await api.providerRemove(cfg.id)
              onSaved()
            }}
          >
            删除
          </button>
        )}
      </div>
    </div>
  )
}

function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  useEffect(() => {
    if (!('speechSynthesis' in window)) return
    const load = () => setVoices(speechSynthesis.getVoices())
    load()
    speechSynthesis.addEventListener('voiceschanged', load)
    return () => speechSynthesis.removeEventListener('voiceschanged', load)
  }, [])
  return voices
}

export function SettingsTab({ snap, onRefresh }: { snap: Snapshot; onRefresh: () => void }) {
  const voices = useVoices()
  const s = snap.settings
  const toast = useToast()
  const [editing, setEditing] = useState(s.activeProviderId)
  const [embKey, setEmbKey] = useState('')
  const [sttKey, setSttKey] = useState('')
  const [update_, setUpdate] = useState<string>('')
  const [diag, setDiag] = useState('')
  const provider = s.providers.find((p) => p.id === editing) ?? s.providers[0]
  const update = (patch: Partial<Settings>) => void api.settingsUpdate(patch)

  return (
    <div className="stack">
      <Section title="AI 模型" desc="API Key 用系统钥匙串加密保存在本机，只在调用模型时发给对应服务商。">
        <div className="provider-tabs">
          {s.providers.map((p) => (
            <button key={p.id} className={`chip ${editing === p.id ? 'active' : ''}`} onClick={() => setEditing(p.id)}>
              {p.id === s.activeProviderId && '⭐ '}
              {p.name}
              {(p.hasKey || p.noKey) && ' ✓'}
            </button>
          ))}
          <button
            className="chip"
            onClick={async () => {
              const id = `custom_${Date.now().toString(36)}`
              await api.providerUpsert({ id, name: '自定义服务商', kind: 'openai', baseURL: 'https://', model: '' })
              setEditing(id)
              onRefresh()
            }}
          >
            ＋ 自定义
          </button>
        </div>
        {provider && <ProviderEditor provider={provider} isActive={provider.id === s.activeProviderId} onSaved={onRefresh} />}
        <Field label="记忆 / 日记用的模型" hint="后台整理记忆、写日记时使用。可以选一个便宜的模型省钱。">
          <select value={s.memoryProviderId} onChange={(e) => update({ memoryProviderId: e.target.value })}>
            <option value="">和聊天模型相同</option>
            {s.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.model}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <Section title="记忆" desc="向量记忆可以按“意思”而不只是关键词找回记忆。DeepSeek 没有向量接口，可以用硅基流动的免费 bge-m3。">
        <Field label="自动记住重要的事">
          <Toggle checked={s.memory.autoExtract} onChange={(v) => update({ memory: { ...s.memory, autoExtract: v } })} label="每轮对话后让模型整理记忆（会多一次调用）" />
        </Field>
        <Field label="每天写日记">
          <Toggle checked={s.memory.dailyDiary} onChange={(v) => update({ memory: { ...s.memory, dailyDiary: v } })} />
        </Field>
        <Field label="每次带入的记忆数">
          <input type="number" min={0} max={20} value={s.memory.maxRetrieved} onChange={(e) => update({ memory: { ...s.memory, maxRetrieved: Number(e.target.value) } })} />
        </Field>
        <Field label="向量记忆 (Embedding)">
          <Toggle checked={s.embedding.enabled} onChange={(v) => update({ embedding: { ...s.embedding, enabled: v } })} />
        </Field>
        {s.embedding.enabled && (
          <>
            <Field label="预设">
              <select
                value=""
                onChange={(e) => {
                  const p = EMBEDDING_PRESETS.find((x) => x.name === e.target.value)
                  if (p) update({ embedding: { ...s.embedding, baseURL: p.baseURL, model: p.model } })
                }}
              >
                <option value="">选择一个预设…</option>
                {EMBEDDING_PRESETS.map((p) => (
                  <option key={p.name}>{p.name}</option>
                ))}
              </select>
            </Field>
            <Field label="接口地址">
              <input value={s.embedding.baseURL} onChange={(e) => update({ embedding: { ...s.embedding, baseURL: e.target.value } })} />
            </Field>
            <Field label="模型">
              <input value={s.embedding.model} onChange={(e) => update({ embedding: { ...s.embedding, model: e.target.value } })} />
            </Field>
            <Field label="API Key 来源">
              <select value={s.embedding.keyFrom} onChange={(e) => update({ embedding: { ...s.embedding, keyFrom: e.target.value } })}>
                <option value="own">单独填写</option>
                {s.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    复用「{p.name}」的 Key
                  </option>
                ))}
              </select>
            </Field>
            {s.embedding.keyFrom === 'own' && (
              <Field label="Embedding Key" hint={s.embeddingHasOwnKey ? '✅ 已保存' : '还没有填写'}>
                <div className="row">
                  <input type="password" value={embKey} onChange={(e) => setEmbKey(e.target.value)} placeholder="sk-..." />
                  <button
                    className="btn"
                    onClick={async () => {
                      await api.setApiKey('embedding', embKey)
                      setEmbKey('')
                      toast('已保存')
                      onRefresh()
                    }}
                  >
                    保存
                  </button>
                </div>
              </Field>
            )}
            <div className="row">
              <button
                className="btn"
                onClick={async () => {
                  const r = await api.testEmbedding()
                  toast(r.message, r.ok ? 'ok' : 'err')
                }}
              >
                测试向量接口
              </button>
            </div>
          </>
        )}
      </Section>

      <Section title="主动搭话">
        <Field label="频率">
          <select value={s.proactive.level} onChange={(e) => update({ proactive: { ...s.proactive, level: e.target.value as Settings['proactive']['level'] } })}>
            <option value="off">关闭</option>
            <option value="low">偶尔（每天最多 3 次）</option>
            <option value="medium">适中（每天最多 6 次）</option>
            <option value="high">话痨（每天最多 10 次）</option>
          </select>
        </Field>
        <Field label="安静时段">
          <div className="row">
            <Toggle checked={s.proactive.quietEnabled} onChange={(v) => update({ proactive: { ...s.proactive, quietEnabled: v } })} />
            <input type="time" value={s.proactive.quietStart} onChange={(e) => update({ proactive: { ...s.proactive, quietStart: e.target.value } })} />
            <span>到</span>
            <input type="time" value={s.proactive.quietEnd} onChange={(e) => update({ proactive: { ...s.proactive, quietEnd: e.target.value } })} />
          </div>
        </Field>
        <Field label="用 AI 生成台词" hint="关闭时使用内置台词，不花 token">
          <Toggle checked={s.proactive.useAI} onChange={(v) => update({ proactive: { ...s.proactive, useAI: v } })} />
        </Field>
      </Section>

      <Section title="语音朗读" desc="用系统自带的语音（Windows 上通常有“晓晓”“慧慧”等中文语音）读出它说的话，不花 token、不联网。">
        <Field label="朗读回复">
          <Toggle checked={s.voice.enabled} onChange={(v) => update({ voice: { ...s.voice, enabled: v } })} />
        </Field>
        <Field label="声音" hint={voices.length ? '' : '没有找到系统语音；Windows 可在“设置 → 时间和语言 → 语音”里添加中文语音'}>
          <select value={s.voice.voiceName} onChange={(e) => update({ voice: { ...s.voice, voiceName: e.target.value } })}>
            <option value="">自动选择中文语音</option>
            {voices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name}（{v.lang}）
              </option>
            ))}
          </select>
        </Field>
        <Field label="语速" hint={s.voice.rate.toFixed(1)}>
          <input type="range" min={0.5} max={2} step={0.1} value={s.voice.rate} onChange={(e) => update({ voice: { ...s.voice, rate: Number(e.target.value) } })} />
        </Field>
        <Field label="音调" hint={s.voice.pitch.toFixed(1)}>
          <input type="range" min={0.5} max={2} step={0.1} value={s.voice.pitch} onChange={(e) => update({ voice: { ...s.voice, pitch: Number(e.target.value) } })} />
        </Field>
        <div className="row">
          <button className="btn" onClick={() => speak(`你好呀，我是${snap.persona.name}，今天也要开开心心的哦！`, s.voice, true)}>
            试听
          </button>
        </div>
      </Section>

      <Section title="语音输入" desc="在聊天框里按住 🎤 说话，松开后转成文字发给它。需要一个语音识别接口，推荐硅基流动的 SenseVoice（免费）。">
        <Field label="开启语音输入">
          <Toggle checked={s.stt.enabled} onChange={(v) => update({ stt: { ...s.stt, enabled: v } })} />
        </Field>
        {s.stt.enabled && (
          <>
            <Field label="预设">
              <select
                value=""
                onChange={(e) => {
                  const p = STT_PRESETS.find((x) => x.name === e.target.value)
                  if (p) update({ stt: { ...s.stt, baseURL: p.baseURL, model: p.model, keyFrom: p.keyFrom } })
                }}
              >
                <option value="">选择一个预设…</option>
                {STT_PRESETS.map((p) => (
                  <option key={p.name}>{p.name}</option>
                ))}
              </select>
            </Field>
            <Field label="接口地址">
              <input value={s.stt.baseURL} onChange={(e) => update({ stt: { ...s.stt, baseURL: e.target.value } })} />
            </Field>
            <Field label="模型">
              <input value={s.stt.model} onChange={(e) => update({ stt: { ...s.stt, model: e.target.value } })} />
            </Field>
            <Field label="语言" hint="留空自动识别；Whisper 可以填 zh 提高中文准确率">
              <input value={s.stt.language} placeholder="自动" onChange={(e) => update({ stt: { ...s.stt, language: e.target.value.trim() } })} />
            </Field>
            <Field label="API Key 来源">
              <select value={s.stt.keyFrom} onChange={(e) => update({ stt: { ...s.stt, keyFrom: e.target.value } })}>
                <option value="own">单独填写</option>
                {s.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    复用「{p.name}」的 Key{p.hasKey ? '' : '（还没填）'}
                  </option>
                ))}
              </select>
            </Field>
            {s.stt.keyFrom === 'own' && (
              <Field label="语音识别 Key" hint={s.sttHasOwnKey ? '✅ 已保存' : '还没有填写'}>
                <div className="row">
                  <input type="password" value={sttKey} onChange={(e) => setSttKey(e.target.value)} placeholder="sk-..." />
                  <button
                    className="btn"
                    onClick={async () => {
                      await api.setApiKey('stt', sttKey)
                      setSttKey('')
                      toast('已保存')
                      onRefresh()
                    }}
                  >
                    保存
                  </button>
                </div>
              </Field>
            )}
          </>
        )}
      </Section>

      <Section title="天气" desc="开启后它会知道你那里的天气（下雨提醒带伞之类）。只会把你填的城市名发给 wttr.in。">
        <Field label="开启">
          <Toggle checked={s.weather.enabled} onChange={(v) => update({ weather: { ...s.weather, enabled: v } })} />
        </Field>
        <Field label="城市" hint="中文或拼音都可以，例如：北京、Shanghai">
          <div className="row">
            <input defaultValue={s.weather.city} placeholder="城市名" onBlur={(e) => e.target.value.trim() !== s.weather.city && update({ weather: { ...s.weather, city: e.target.value.trim() } })} />
            <button
              className="btn"
              onClick={async () => {
                const r = await api.weatherTest()
                toast(r.ok ? r.text! : r.error ?? '查询失败', r.ok ? 'ok' : 'err')
              }}
            >
              查一下
            </button>
          </div>
        </Field>
      </Section>

      <Section title="养成 & 费用">
        <Field label="难度" hint="影响数值下降速度。关掉程序时的变化总是更温和，而且最多只结算 12 小时。">
          <select value={s.game.difficulty} onChange={(e) => update({ game: { ...s.game, difficulty: e.target.value as Settings['game']['difficulty'] } })}>
            <option value="casual">休闲</option>
            <option value="normal">标准</option>
            <option value="hard">硬核</option>
          </select>
        </Field>
        <Field label="每日 token 上限" hint={`0 表示不限制。今天已用 ${(snap.usageToday.input + snap.usageToday.output).toLocaleString()}`}>
          <input type="number" min={0} step={10000} value={s.chat.dailyTokenLimit} onChange={(e) => update({ chat: { ...s.chat, dailyTokenLimit: Number(e.target.value) } })} />
        </Field>
        <Field label="聊天上下文长度" hint="带入最近多少字的聊天记录">
          <input type="number" min={500} max={40000} step={500} value={s.chat.historyChars} onChange={(e) => update({ chat: { ...s.chat, historyChars: Number(e.target.value) } })} />
        </Field>
      </Section>

      <Section title="通用">
        <Field label="免打扰">
          <Toggle checked={s.app.dnd} onChange={(v) => update({ app: { ...s.app, dnd: v } })} label="不主动说话" />
        </Field>
        <Field label="鼠标穿透" hint="打开后宠物不会挡住鼠标点击（无法拖动和右键它），通过托盘图标操作">
          <Toggle checked={s.app.clickThrough} onChange={(v) => update({ app: { ...s.app, clickThrough: v } })} />
        </Field>
        {snap.platform === 'win32' && (
          <Field label="全屏时自动躲起来" hint="看视频、玩游戏、放幻灯片时自动隐藏，退出全屏后回来">
            <Toggle checked={s.app.hideOnFullscreen} onChange={(v) => update({ app: { ...s.app, hideOnFullscreen: v } })} />
          </Field>
        )}
        <Field label="窗口置顶">
          <Toggle checked={s.app.alwaysOnTop} onChange={(v) => update({ app: { ...s.app, alwaysOnTop: v } })} />
        </Field>
        <Field label="开机自启">
          <Toggle checked={s.app.autoStart} onChange={(v) => update({ app: { ...s.app, autoStart: v } })} />
        </Field>
        <Field label="聊天快捷键" hint="Electron 加速键格式，例如 CommandOrControl+Alt+P（Ctrl+Alt+P）">
          <input defaultValue={s.app.hotkey} onBlur={(e) => e.target.value !== s.app.hotkey && update({ app: { ...s.app, hotkey: e.target.value } })} />
        </Field>
        <Field label="隐藏 / 显示快捷键" hint="看视频、开会共享屏幕时一键藏起来">
          <input defaultValue={s.app.hideHotkey} onBlur={(e) => e.target.value !== s.app.hideHotkey && update({ app: { ...s.app, hideHotkey: e.target.value } })} />
        </Field>
        <Field label="网络代理" hint="留空 = 跟随系统代理。例如 http://127.0.0.1:7890 或 socks5://127.0.0.1:1080（访问 OpenAI / Claude 时可能需要）">
          <input defaultValue={s.app.proxy} placeholder="跟随系统" onBlur={(e) => e.target.value.trim() !== s.app.proxy && update({ app: { ...s.app, proxy: e.target.value.trim() } })} />
        </Field>
        <Field label="数据目录" hint="存档、聊天记录、记忆库都在这里，整个文件夹复制走就是完整备份">
          <div className="row">
            <code className="path">{snap.dataDir}</code>
            <button className="btn ghost" onClick={() => void api.openDataFolder()}>
              打开
            </button>
            <button className="btn ghost" onClick={() => void api.openLogsFolder()}>
              查看日志
            </button>
          </div>
        </Field>
      </Section>
      <Section title="关于" desc={`SoulPet 灵宠 v${snap.version} · MIT 开源 · 数据只保存在本机`}>
        <Field label="自动检查更新" hint="启动时查询 GitHub Releases，只告诉你有新版本，不会自动下载">
          <Toggle checked={s.app.checkUpdates} onChange={(v) => update({ app: { ...s.app, checkUpdates: v } })} />
        </Field>
        <div className="row">
          <button
            className="btn"
            onClick={async () => {
              setUpdate('检查中…')
              const r = await api.checkUpdate()
              if (!r.ok) setUpdate(`检查失败：${r.error}`)
              else if (r.latest) {
                setUpdate(`发现新版本 ${r.latest.version}`)
                void api.openExternal(r.latest.url)
              } else setUpdate('已经是最新版本')
            }}
          >
            检查更新
          </button>
          <button className="btn ghost" onClick={() => void api.openExternal('https://github.com/callaumyan-design/dsh/tree/desktop-pet')}>
            项目主页
          </button>
          {update_ && <span className="muted">{update_}</span>}
          <button
            className="btn ghost"
            onClick={async () => {
              const d = await api.diagnostics()
              const text = Object.entries(d)
                .map(([k, v]) => `${k}: ${v}`)
                .join('\n')
              setDiag(text)
            }}
          >
            诊断信息
          </button>
        </div>
        {diag && <pre className="diag">{diag}</pre>}
      </Section>
    </div>
  )
}
