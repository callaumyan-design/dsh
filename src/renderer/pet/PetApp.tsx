import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { EMOTION_ANIM, type Emotion } from '../../core/ai/emotion'
import { CONDITION_LABEL, expToNext, STAGE_SCALE, stageOf } from '../../core/game/engine'
import type { Condition, GameState, PetAnimState } from '../../core/game/types'
import type { MotionEvent, PetSayEvent, PublicSettings } from '../../core/ipc'
import { builtinPack, type ResolvedPack } from '../../core/pets/pack'
import type { FocusSession } from '../../core/tasks'
import { api } from '../shared/api'
import { PetView } from '../shared/PetView'
import { speak } from '../shared/speech'
import { useRecorder, type Recording } from '../shared/useRecorder'

const BUBBLE_SPACE = 150
const MIN_W = 240
/** pressing 🎤 in the small menu longer than this = push-to-talk (release sends); shorter = tap to start, tap ■ to send */
const HOLD_MS = 400
const MAX_VOICE_MS = 60_000
const MENU_IDLE_MS = 5000

/** the small right-click menu: two buttons, or the "listening" pill it turns into */
type Mini = null | 'menu' | 'voice'

const svg = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
const MicIcon = () => (
  <svg {...svg}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
  </svg>
)
const KeyboardIcon = () => (
  <svg {...svg}>
    <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
    <path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M8 14h8" />
  </svg>
)

interface Bubble {
  text: string
  emotion: Emotion | null
  streaming: boolean
  error?: boolean
}

function idleFor(game: GameState, conds: Condition[]): PetAnimState {
  if (game.asleep) return 'sleep'
  if (conds.includes('sick')) return 'sick'
  if (conds.includes('starving') || conds.includes('sad')) return 'sad'
  return 'idle'
}

function fmtRemain(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function bubbleDuration(text: string): number {
  return Math.min(16_000, Math.max(3500, text.length * 220))
}

export function PetApp() {
  const [game, setGame] = useState<GameState | null>(null)
  const [conds, setConds] = useState<Condition[]>([])
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [packs, setPacks] = useState<ResolvedPack[]>([builtinPack()])
  const [motion, setMotion] = useState<MotionEvent>({ mode: 'idle', dir: 'right' })
  const [bubble, setBubble] = useState<Bubble | null>(null)
  const [oneShot, setOneShot] = useState<{ anim: PetAnimState; until: number } | null>(null)
  const [thinking, setThinking] = useState(false)
  const [inputOpen, setInputOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [hover, setHover] = useState(false)
  const [hearts, setHearts] = useState<number[]>([])
  const [petName, setPetName] = useState('它')
  const [focus, setFocus] = useState<FocusSession | null>(null)
  const [live2dCore, setLive2dCore] = useState<string | null>(null)
  const [hearing, setHearing] = useState(false)
  const [mini, setMini] = useState<Mini>(null)
  const recorder = useRecorder()
  const [, force] = useState(0)

  const bubbleTimer = useRef<number | null>(null)
  const voiceRef = useRef<PublicSettings['voice'] | null>(null)
  voiceRef.current = settings?.voice ?? null
  const inputRef = useRef<HTMLInputElement>(null)
  const drag = useRef<{ x: number; y: number; dragging: boolean } | null>(null)
  const clickTimer = useRef<number | null>(null)
  const miniRef = useRef<HTMLDivElement>(null)
  const miniTimer = useRef<number | null>(null)
  const voiceAt = useRef(0)

  // While a reply streams, other lines (achievements, reminders...) wait in a queue so they
  // never overwrite or truncate the reply.
  const streaming = useRef(false)
  const streamText = useRef('')
  const sayQueue = useRef<PetSayEvent[]>([])
  const presentSay = useRef<(p: PetSayEvent) => void>(() => {})

  const showBubble = useCallback((b: Bubble, duration?: number) => {
    if (bubbleTimer.current) window.clearTimeout(bubbleTimer.current)
    bubbleTimer.current = null
    setBubble(b)
    if (!b.streaming) {
      bubbleTimer.current = window.setTimeout(() => {
        bubbleTimer.current = null
        const next = streaming.current ? undefined : sayQueue.current.shift()
        if (next) presentSay.current(next)
        else setBubble(null)
      }, duration || bubbleDuration(b.text))
    }
  }, [])

  const playOnce = useCallback((anim: PetAnimState, ms = 2600) => {
    setOneShot({ anim, until: Date.now() + ms })
    window.setTimeout(() => force((n) => n + 1), ms + 20)
  }, [])

  presentSay.current = (p: PetSayEvent) => {
    showBubble({ text: p.text, emotion: p.emotion ?? null, streaming: false }, p.duration)
    if (voiceRef.current) speak(p.text, voiceRef.current)
    const anim = p.anim ?? (p.emotion ? EMOTION_ANIM[p.emotion] : undefined)
    if (anim) playOnce(anim, 2800)
  }

  useEffect(() => {
    void api.getSnapshot().then((s) => {
      setGame(s.game)
      setConds(s.conditions)
      setSettings(s.settings)
      setPacks(s.packs)
      setPetName(s.persona.name)
      setFocus(s.tasks.focus)
      setLive2dCore(s.live2dCore)
    })
    const off = [
      api.on('persona:update', (p) => setPetName(p.name)),
      api.on('tasks:update', (t) => setFocus(t.focus)),
      api.on('game:update', (p) => {
        setGame(p.game)
        setConds(p.conditions)
      }),
      api.on('settings:update', setSettings),
      api.on('packs:update', setPacks),
      api.on('live2d:core', ({ url }) => setLive2dCore(url)),
      api.on('pet:motion', setMotion),
      api.on('pet:say', (p) => {
        if (streaming.current || bubbleTimer.current) {
          sayQueue.current.push(p)
          if (sayQueue.current.length > 3) sayQueue.current.shift()
        } else presentSay.current(p)
      }),
      api.on('pet:anim', (p) => playOnce(p.anim, p.duration)),
      api.on('chat:start', () => {
        streaming.current = true
        streamText.current = ''
        setThinking(true)
        showBubble({ text: '', emotion: null, streaming: true })
      }),
      api.on('chat:delta', (p) => {
        streamText.current += p.delta
        const text = streamText.current
        setBubble((b) => ({ text, emotion: p.emotion ?? b?.emotion ?? null, streaming: true }))
      }),
      api.on('chat:done', (p) => {
        streaming.current = false
        setThinking(false)
        showBubble({ text: p.message.content, emotion: p.message.emotion ?? null, streaming: false })
        if (p.message.emotion) playOnce(EMOTION_ANIM[p.message.emotion], 3200)
        if (voiceRef.current && !p.message.error) speak(p.message.content, voiceRef.current)
      }),
      api.on('chat:error', (p) => {
        streaming.current = false
        setThinking(false)
        showBubble({ text: p.message, emotion: 'sad', streaming: false, error: true }, 7000)
        playOnce('sad')
      }),
      api.on('pet:openInput', () => {
        setMini((m) => (m === 'voice' ? m : null))
        setInputOpen(true)
      })
    ]
    return () => off.forEach((f) => f())
  }, [showBubble, playOnce])

  const pack = useMemo(() => packs.find((p) => p.id === settings?.appearance.packId) ?? packs[0] ?? builtinPack(), [packs, settings?.appearance.packId])
  const stage = stageOf(game?.level ?? 1)
  const scale = (settings?.appearance.scale ?? 1) * STAGE_SCALE[stage]
  const petW = Math.round(pack.width * scale)
  const petH = Math.round(pack.height * scale)
  const winW = Math.max(MIN_W, petW + 40)
  const winH = petH + BUBBLE_SPACE

  useEffect(() => {
    api.petSetSize(winW, winH)
  }, [winW, winH])

  const focusing = !!focus && focus.endsAt > Date.now()
  useEffect(() => {
    if (!focusing) return
    const t = window.setInterval(() => force((n) => n + 1), 1000)
    return () => window.clearInterval(t)
  }, [focusing])

  useEffect(() => {
    api.petInputState(inputOpen)
    if (inputOpen) {
      api.petSetInteractive(true)
      window.setTimeout(() => inputRef.current?.focus(), 30)
    } else if (!hover && !mini) {
      api.petSetInteractive(false)
    }
  }, [inputOpen, hover, mini])

  useEffect(() => {
    api.petMenuState(mini !== null)
    if (mini) api.petSetInteractive(true)
  }, [mini])

  // ------------------------------------------------------------ animation state
  let state: PetAnimState = game ? (focusing && !game.asleep ? 'work' : idleFor(game, conds)) : 'idle'
  const now = Date.now()
  if (motion.mode === 'drag') state = 'drag'
  else if (motion.mode === 'fall') state = 'fall'
  else if (oneShot && oneShot.until > now) state = oneShot.anim
  else if (thinking && !bubble?.text) state = 'think'
  else if (bubble?.streaming) state = bubble.emotion ? EMOTION_ANIM[bubble.emotion] : 'talk'
  else if (motion.mode === 'walk') state = motion.dir === 'left' ? 'walk_left' : 'walk'
  const emotion = bubble?.emotion ?? null

  // ------------------------------------------------------------ interactions
  const onPetMouseDown = (e: ReactMouseEvent) => {
    if (e.button !== 0) return
    drag.current = { x: e.screenX, y: e.screenY, dragging: false }
    const move = (ev: MouseEvent) => {
      const d = drag.current
      if (d && !d.dragging && Math.hypot(ev.screenX - d.x, ev.screenY - d.y) > 5) {
        d.dragging = true
        api.petDragStart()
      }
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      const d = drag.current
      drag.current = null
      if (d?.dragging) {
        api.petDragEnd()
        return
      }
      if (clickTimer.current) {
        window.clearTimeout(clickTimer.current)
        clickTimer.current = null
        setInputOpen(true)
        return
      }
      clickTimer.current = window.setTimeout(() => {
        clickTimer.current = null
        const id = Date.now()
        setHearts((h) => [...h.slice(-4), id])
        window.setTimeout(() => setHearts((h) => h.filter((x) => x !== id)), 1200)
        void api.gameAction({ type: 'pet' }).then((r) => {
          if (r.anim) playOnce(r.anim, 1800)
          if (r.leveledUp || !r.ok || /别戳/.test(r.message)) showBubble({ text: r.message, emotion: null, streaming: false }, 2500)
        })
      }, 240)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const send = () => {
    const text = draft.trim()
    if (!text) return setInputOpen(false)
    setDraft('')
    setInputOpen(false)
    void api.chatSend(text).then((r) => {
      if (!r.ok && r.error) showBubble({ text: r.error, emotion: 'sad', streaming: false, error: true }, 4000)
    })
  }

  const startTalk = async () => {
    try {
      await recorder.start()
    } catch (e) {
      showBubble({ text: `打不开麦克风：${(e as Error).message}`, emotion: 'sad', streaming: false, error: true }, 5000)
    }
  }
  /** speech → text → chat. Returns once the text is known (the reply streams in by itself). */
  const transcribeAndSend = async (rec: Recording) => {
    setHearing(true)
    const r = await api.sttTranscribe(rec.data, rec.mime).catch((e: Error) => ({ ok: false, text: '', error: e.message }))
    setHearing(false)
    if (!r.ok || !r.text) return showBubble({ text: r.error ?? '没听清', emotion: 'sad', streaming: false, error: true }, 5000)
    setDraft('')
    setInputOpen(false)
    void api.chatSend(r.text).then((res) => {
      if (!res.ok && res.error) showBubble({ text: res.error, emotion: 'sad', streaming: false, error: true }, 4000)
    })
  }

  const stopTalk = async () => {
    const rec = await recorder.stop()
    if (!rec) return
    if (rec.ms < 500) return showBubble({ text: '按住 🎤 说话，说完再松开哦~', emotion: null, streaming: false }, 3000)
    await transcribeAndSend(rec)
  }

  // ------------------------------------------------------------ small right-click menu
  const clearMiniTimer = () => {
    if (miniTimer.current) window.clearTimeout(miniTimer.current)
    miniTimer.current = null
  }
  /** an untouched menu goes away by itself */
  const armMiniTimer = () => {
    clearMiniTimer()
    miniTimer.current = window.setTimeout(() => setMini((m) => (m === 'menu' ? null : m)), MENU_IDLE_MS)
  }

  const openMenu = () => {
    if (mini === 'voice') return
    setInputOpen(false)
    setMini('menu')
    armMiniTimer()
  }

  /** end the voice pill: send what was said, or throw it away */
  const finishVoice = async (send: boolean) => {
    const rec = await recorder.stop()
    if (send && rec && rec.ms >= 500) await transcribeAndSend(rec)
    else if (send && rec) showBubble({ text: '没听到声音呢，再说一次吧~', emotion: null, streaming: false }, 3000)
    setMini(null)
  }
  const finishVoiceRef = useRef(finishVoice)
  finishVoiceRef.current = finishVoice

  const onMiniMic = (e: ReactMouseEvent) => {
    e.preventDefault()
    if (e.button !== 0) return
    clearMiniTimer()
    if (!settings?.stt?.enabled) {
      setMini(null)
      showBubble({ text: '语音输入还没打开~ 我把设置打开啦，在「语音输入」里开一下就能用', emotion: null, streaming: false }, 6000)
      void api.openPanel('settings')
      return
    }
    setMini('voice')
    const at = Date.now()
    voiceAt.current = at
    const up = () => {
      window.removeEventListener('mouseup', up)
      // held down = push-to-talk; a quick tap keeps listening until ■ is pressed
      if (Date.now() - at >= HOLD_MS && voiceAt.current === at) void finishVoiceRef.current(true)
    }
    window.addEventListener('mouseup', up)
    recorder.start().catch((err: Error) => {
      setMini(null)
      showBubble({ text: `打不开麦克风：${err.message}`, emotion: 'sad', streaming: false, error: true }, 5000)
    })
  }

  const onMiniType = () => {
    clearMiniTimer()
    setMini(null)
    setInputOpen(true)
  }

  // Esc / clicking another window closes the menu (and drops an unfinished recording)
  useEffect(() => {
    if (!mini) return
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (mini === 'menu') setMini(null)
      else if (!hearing) void finishVoiceRef.current(false)
    }
    const blur = () => {
      if (mini === 'menu') setMini(null)
      else if (!hearing) void finishVoiceRef.current(false)
    }
    window.addEventListener('keydown', key)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('blur', blur)
    }
  }, [mini, hearing])

  // a forgotten recording stops (and sends) by itself
  useEffect(() => {
    if (mini !== 'voice' || !recorder.recording) return
    const tick = window.setInterval(() => force((n) => n + 1), 1000)
    const cap = window.setTimeout(() => void finishVoiceRef.current(true), MAX_VOICE_MS)
    return () => {
      window.clearInterval(tick)
      window.clearTimeout(cap)
    }
  }, [mini, recorder.recording])

  useEffect(() => () => clearMiniTimer(), [])

  const enter = () => {
    setHover(true)
    api.petSetInteractive(true)
  }
  const leave = () => {
    setHover(false)
    if (!inputOpen && !mini && !drag.current) api.petSetInteractive(false)
  }

  if (!game || !settings) return null
  const s = game.stats
  const bars: Array<[string, number, string]> = [
    ['饱食', s.satiety, '#f5a623'],
    ['心情', s.mood, '#ff6f91'],
    ['精力', s.energy, '#4fc3f7'],
    ['清洁', s.cleanliness, '#7bd88f'],
    ['健康', s.health, '#e5484d']
  ]

  return (
    <div
      className="pet-root"
      style={{ width: winW, height: winH, opacity: settings.appearance.opacity ?? 1 }}
      onMouseDownCapture={(e) => {
        // a click anywhere outside the small menu closes it
        if (mini === 'menu' && !miniRef.current?.contains(e.target as Node)) setMini(null)
      }}
    >
      <div className="top-area" style={{ height: BUBBLE_SPACE }}>
        {mini ? (
          <div
            ref={miniRef}
            className="mini hit"
            onMouseEnter={() => (enter(), clearMiniTimer())}
            onMouseLeave={() => (leave(), mini === 'menu' && armMiniTimer())}
            onContextMenu={(e) => e.preventDefault()}
          >
            {mini === 'menu' ? (
              <>
                <button key="mic" className={`mini-btn ${settings.stt?.enabled ? '' : 'off'}`} title="说话：按住说、松开发送；或者点一下开始" onMouseDown={onMiniMic}>
                  <MicIcon />
                </button>
                <button key="type" className="mini-btn" title="打字" onClick={onMiniType}>
                  <KeyboardIcon />
                </button>
              </>
            ) : hearing ? (
              <span className="mini-label">识别中…</span>
            ) : (
              <>
                <button key="stop" className="mini-btn rec" title="说完了，发送" onMouseDown={(e) => (e.preventDefault(), void finishVoice(true))}>
                  <span className="rec-dot" />
                </button>
                <span className="mini-label">{recorder.recording ? `正在听 ${Math.floor((Date.now() - voiceAt.current) / 1000)}s` : '准备中…'}</span>
                <button key="cancel" className="mini-btn ghost" title="取消" onMouseDown={(e) => (e.preventDefault(), void finishVoice(false))}>
                  ✕
                </button>
              </>
            )}
          </div>
        ) : inputOpen ? (
          <div className="quick-input hit" onMouseEnter={enter} onMouseLeave={leave}>
            {settings.stt?.enabled && (
              <button
                className={`mic ${recorder.recording ? 'on' : ''}`}
                title="按住说话，松开发送"
                onMouseDown={(e) => (e.preventDefault(), void startTalk())}
                onMouseUp={() => void stopTalk()}
                onMouseLeave={() => recorder.recording && void stopTalk()}
              >
                {hearing ? '…' : '🎤'}
              </button>
            )}
            <input
              ref={inputRef}
              value={draft}
              placeholder={recorder.recording ? '正在听……松开就发送' : hearing ? '识别中…' : `和${petName}说点什么…（Enter 发送）`}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) send()
                if (e.key === 'Escape') setInputOpen(false)
              }}
              onBlur={() => !draft.trim() && setInputOpen(false)}
            />
            <button onMouseDown={(e) => e.preventDefault()} onClick={send}>
              发送
            </button>
          </div>
        ) : bubble && (bubble.text || bubble.streaming) ? (
          <div
            className={`bubble hit ${bubble.error ? 'error' : ''}`}
            onMouseEnter={enter}
            onMouseLeave={leave}
            onClick={() => void api.openPanel('chat')}
            title="点击打开聊天面板"
          >
            <div className="bubble-text">
              {bubble.text || <span className="dots">…</span>}
              {bubble.streaming && bubble.text && <span className="caret" />}
            </div>
          </div>
        ) : focusing && !hover ? (
          <div className="focus-badge">🍅 {fmtRemain(focus!.endsAt - Date.now())}</div>
        ) : hover && !drag.current ? (
          <div className="hud">
            <div className="hud-head">
              Lv.{game.level} · {CONDITION_LABEL[conds[0] ?? 'content']} · 🪙{game.coins}
            </div>
            {bars.map(([label, v, color]) => (
              <div className="hud-row" key={label}>
                <span>{label}</span>
                <div className="hud-bar">
                  <div style={{ width: `${v}%`, background: color }} />
                </div>
              </div>
            ))}
            <div className="hud-row">
              <span>经验</span>
              <div className="hud-bar">
                <div style={{ width: `${(game.exp / expToNext(game.level)) * 100}%`, background: '#8b7bff' }} />
              </div>
            </div>
          </div>
        ) : null}
      </div>
      <div
        className="pet hit"
        style={{ width: petW, height: petH }}
        onMouseDown={onPetMouseDown}
        onMouseEnter={enter}
        onMouseLeave={leave}
        onContextMenu={(e) => {
          e.preventDefault()
          openMenu()
        }}
        data-state={state}
      >
        <PetView
          pack={pack}
          state={state}
          emotion={emotion}
          appearance={settings.appearance}
          stage={stage}
          width={petW}
          height={petH}
          sleepy={conds.includes('tired') || conds.includes('exhausted')}
          sick={conds.includes('sick')}
          live2dCore={live2dCore}
          talking={!!bubble?.streaming && !!bubble.text}
        />
        {hearts.map((id) => (
          <span key={id} className="heart">
            ❤
          </span>
        ))}
      </div>
    </div>
  )
}
