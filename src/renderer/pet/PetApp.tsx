import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { EMOTION_ANIM, type Emotion } from '../../core/ai/emotion'
import { CONDITION_LABEL, expToNext, STAGE_SCALE, stageOf } from '../../core/game/engine'
import type { Condition, GameState, PetAnimState } from '../../core/game/types'
import type { MotionEvent, PublicSettings } from '../../core/ipc'
import { builtinPack, type ResolvedPack } from '../../core/pets/pack'
import type { FocusSession } from '../../core/tasks'
import { api } from '../shared/api'
import { PetView } from '../shared/PetView'
import { speak } from '../shared/speech'
import { useRecorder } from '../shared/useRecorder'

const BUBBLE_SPACE = 150
const MIN_W = 240

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
  const recorder = useRecorder()
  const [, force] = useState(0)

  const bubbleTimer = useRef<number | null>(null)
  const voiceRef = useRef<PublicSettings['voice'] | null>(null)
  voiceRef.current = settings?.voice ?? null
  const inputRef = useRef<HTMLInputElement>(null)
  const drag = useRef<{ x: number; y: number; dragging: boolean } | null>(null)
  const clickTimer = useRef<number | null>(null)

  const showBubble = useCallback((b: Bubble, duration?: number) => {
    if (bubbleTimer.current) window.clearTimeout(bubbleTimer.current)
    setBubble(b)
    if (!b.streaming) bubbleTimer.current = window.setTimeout(() => setBubble(null), duration || bubbleDuration(b.text))
  }, [])

  const playOnce = useCallback((anim: PetAnimState, ms = 2600) => {
    setOneShot({ anim, until: Date.now() + ms })
    window.setTimeout(() => force((n) => n + 1), ms + 20)
  }, [])

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
      api.on('packs:update', (p) => {
        setPacks(p)
        void api.getSnapshot().then((s) => setLive2dCore(s.live2dCore))
      }),
      api.on('pet:motion', setMotion),
      api.on('pet:say', (p) => {
        showBubble({ text: p.text, emotion: p.emotion ?? null, streaming: false }, p.duration)
        if (voiceRef.current) speak(p.text, voiceRef.current)
        const anim = p.anim ?? (p.emotion ? EMOTION_ANIM[p.emotion] : undefined)
        if (anim) playOnce(anim, 2800)
      }),
      api.on('pet:anim', (p) => playOnce(p.anim, p.duration)),
      api.on('chat:start', () => {
        setThinking(true)
        showBubble({ text: '', emotion: null, streaming: true })
      }),
      api.on('chat:delta', (p) => {
        setBubble((b) => ({ text: (b?.streaming ? b.text : '') + p.delta, emotion: p.emotion ?? b?.emotion ?? null, streaming: true }))
      }),
      api.on('chat:done', (p) => {
        setThinking(false)
        showBubble({ text: p.message.content, emotion: p.message.emotion ?? null, streaming: false })
        if (p.message.emotion) playOnce(EMOTION_ANIM[p.message.emotion], 3200)
        if (voiceRef.current && !p.message.error) speak(p.message.content, voiceRef.current)
      }),
      api.on('chat:error', (p) => {
        setThinking(false)
        showBubble({ text: p.message, emotion: 'sad', streaming: false, error: true }, 7000)
        playOnce('sad')
      }),
      api.on('pet:openInput', () => setInputOpen(true))
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
    } else if (!hover) {
      api.petSetInteractive(false)
    }
  }, [inputOpen, hover])

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
  const stopTalk = async () => {
    const rec = await recorder.stop()
    if (!rec) return
    if (rec.ms < 500) return showBubble({ text: '按住 🎤 说话，说完再松开哦~', emotion: null, streaming: false }, 3000)
    setHearing(true)
    const r = await api.sttTranscribe(rec.data, rec.mime)
    setHearing(false)
    if (!r.ok || !r.text) return showBubble({ text: r.error ?? '没听清', emotion: 'sad', streaming: false, error: true }, 5000)
    setDraft('')
    setInputOpen(false)
    void api.chatSend(r.text).then((res) => {
      if (!res.ok && res.error) showBubble({ text: res.error, emotion: 'sad', streaming: false, error: true }, 4000)
    })
  }

  const enter = () => {
    setHover(true)
    api.petSetInteractive(true)
  }
  const leave = () => {
    setHover(false)
    if (!inputOpen && !drag.current) api.petSetInteractive(false)
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
    <div className="pet-root" style={{ width: winW, height: winH, opacity: settings.appearance.opacity ?? 1 }}>
      <div className="top-area" style={{ height: BUBBLE_SPACE }}>
        {inputOpen ? (
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
          api.petContextMenu()
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
