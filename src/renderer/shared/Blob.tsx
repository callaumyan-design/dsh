/**
 * "团子" — the built-in, original vector slime. Expression and extras are driven by the
 * semantic animation state + the emotion from the last reply, so it reacts like a sprite pet
 * without any image assets. Colour and accessory are user-customisable.
 */
import { useId } from 'react'
import type { Emotion } from '../../core/ai/emotion'
import type { PetAnimState } from '../../core/game/types'
import type { BlobAccessory } from '../../core/settings'

type Face = 'normal' | 'happy' | 'closed' | 'sad' | 'angry' | 'surprised' | 'love' | 'dizzy' | 'up'
type Mouth = 'smile' | 'open' | 'talk' | 'sad' | 'flat' | 'o' | 'chomp' | 'grin'

function shade(hex: string, amt: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const ch = (s: number) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) + amt * 255)))
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`
}

function expression(state: PetAnimState, emotion: Emotion | null, sleepy: boolean): { face: Face; mouth: Mouth } {
  switch (state) {
    case 'sleep': return { face: 'closed', mouth: 'flat' }
    case 'eat': return { face: 'happy', mouth: 'chomp' }
    case 'happy': case 'play': case 'wave': case 'jump': case 'bath':
      return { face: emotion === 'love' ? 'love' : 'happy', mouth: 'open' }
    case 'sad': return { face: 'sad', mouth: 'sad' }
    case 'sick': return { face: 'dizzy', mouth: 'sad' }
    case 'angry': return { face: 'angry', mouth: 'flat' }
    case 'surprised': case 'drag': return { face: 'surprised', mouth: 'o' }
    case 'fall': return { face: 'closed', mouth: 'o' }
    case 'shy': return { face: 'happy', mouth: 'smile' }
    case 'think': case 'work': return { face: 'up', mouth: 'flat' }
    case 'talk': {
      const f: Record<Emotion, Face> = { neutral: 'normal', happy: 'happy', excited: 'happy', sad: 'sad', angry: 'angry', surprised: 'surprised', shy: 'happy', sleepy: 'closed', love: 'love', thinking: 'up' }
      return { face: emotion ? f[emotion] : 'normal', mouth: 'talk' }
    }
    default:
      return sleepy ? { face: 'closed', mouth: 'flat' } : { face: 'normal', mouth: 'smile' }
  }
}

function Eye({ x, face }: { x: number; face: Face }) {
  const y = 86
  switch (face) {
    case 'happy':
      return <path d={`M${x - 7} ${y + 2} Q${x} ${y - 8} ${x + 7} ${y + 2}`} className="ink" strokeWidth={3.5} fill="none" strokeLinecap="round" />
    case 'closed':
      return <path d={`M${x - 7} ${y} Q${x} ${y + 6} ${x + 7} ${y}`} className="ink" strokeWidth={3.5} fill="none" strokeLinecap="round" />
    case 'love':
      return <path d={`M${x} ${y + 7} C${x - 12} ${y - 1} ${x - 6} ${y - 10} ${x} ${y - 3} C${x + 6} ${y - 10} ${x + 12} ${y - 1} ${x} ${y + 7}Z`} fill="#ff5c8a" />
    case 'dizzy':
      return (
        <g className="ink" strokeWidth={3} strokeLinecap="round">
          <line x1={x - 5} y1={y - 5} x2={x + 5} y2={y + 5} />
          <line x1={x + 5} y1={y - 5} x2={x - 5} y2={y + 5} />
        </g>
      )
    case 'surprised':
      return (
        <g>
          <ellipse cx={x} cy={y} rx={8} ry={9.5} className="ink-fill" />
          <circle cx={x + 2.5} cy={y - 3.5} r={3} fill="#fff" />
        </g>
      )
    default: {
      const dy = face === 'up' ? -3 : 0
      return (
        <g>
          <ellipse cx={x} cy={y} rx={6.2} ry={8} className="ink-fill" />
          <circle cx={x + 2 + (face === 'up' ? 1 : 0)} cy={y - 3 + dy} r={2.4} fill="#fff" />
        </g>
      )
    }
  }
}

function Brows({ face }: { face: Face }) {
  if (face === 'sad') return <g className="ink" strokeWidth={2.5} strokeLinecap="round"><line x1="56" y1="73" x2="68" y2="69" /><line x1="114" y1="73" x2="102" y2="69" /></g>
  if (face === 'angry') return <g className="ink" strokeWidth={3} strokeLinecap="round"><line x1="56" y1="69" x2="69" y2="75" /><line x1="114" y1="69" x2="101" y2="75" /></g>
  return null
}

function MouthShape({ mouth }: { mouth: Mouth }) {
  switch (mouth) {
    case 'open': return <path d="M76 101 Q85 116 94 101 Z" className="mouth" />
    case 'talk': return <ellipse cx="85" cy="105" rx="6" ry="5" className="mouth talk-mouth" />
    case 'chomp': return <ellipse cx="85" cy="105" rx="7" ry="5" className="mouth chomp-mouth" />
    case 'sad': return <path d="M77 109 Q85 101 93 109" className="ink" strokeWidth={3} fill="none" strokeLinecap="round" />
    case 'flat': return <path d="M79 106 L91 106" className="ink" strokeWidth={3} strokeLinecap="round" />
    case 'o': return <circle cx="85" cy="106" r="4.5" className="mouth" />
    case 'grin': return <path d="M75 102 Q85 112 95 102" className="ink" strokeWidth={3} fill="none" strokeLinecap="round" />
    default: return <path d="M78 103 Q85 110 92 103" className="ink" strokeWidth={3} fill="none" strokeLinecap="round" />
  }
}

function Accessory({ kind, color }: { kind: BlobAccessory; color: string }) {
  switch (kind) {
    case 'bow':
      return (
        <g transform="translate(118 42) rotate(18)">
          <path d="M0 0 L-15 -9 L-15 9 Z" fill="#ff6f91" />
          <path d="M0 0 L15 -9 L15 9 Z" fill="#ff6f91" />
          <circle r="4.5" fill="#ff9bb3" />
        </g>
      )
    case 'leaf':
      return (
        <g>
          <path d="M85 32 Q86 20 85 14" stroke="#5a9e4b" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M85 18 Q98 6 108 14 Q97 24 85 18Z" fill="#7cc46a" />
        </g>
      )
    case 'crown':
      return <path d="M66 36 L70 18 L78 30 L85 14 L92 30 L100 18 L104 36 Z" fill="#ffd34d" stroke="#e0a800" strokeWidth="2" strokeLinejoin="round" />
    case 'glasses':
      return (
        <g fill="none" stroke="#333" strokeWidth="2.5">
          <circle cx="64" cy="86" r="13" />
          <circle cx="106" cy="86" r="13" />
          <path d="M77 86 Q85 80 93 86" />
        </g>
      )
    case 'cat-ears':
      return (
        <g fill={color} stroke={shade(color, -0.25)} strokeWidth="2.5" strokeLinejoin="round">
          <path d="M42 58 L44 22 L72 38 Z" />
          <path d="M128 58 L126 22 L98 38 Z" />
          <path d="M48 48 L49 31 L63 39 Z" fill="#ffb3c7" stroke="none" />
          <path d="M122 48 L121 31 L107 39 Z" fill="#ffb3c7" stroke="none" />
        </g>
      )
    default:
      return null
  }
}

export function Extras({ state }: { state: PetAnimState }) {
  switch (state) {
    case 'sleep':
      return (
        <g className="zzz" fill="#7a86b6" fontWeight="700" fontFamily="sans-serif">
          <text x="128" y="40" fontSize="16">Z</text>
          <text x="142" y="24" fontSize="12">z</text>
        </g>
      )
    case 'think':
      return (
        <g className="thought">
          <circle cx="140" cy="44" r="4" fill="#fff" stroke="#bbb" />
          <circle cx="150" cy="30" r="6" fill="#fff" stroke="#bbb" />
          <text x="142" y="35" fontSize="10" fill="#888">…</text>
        </g>
      )
    case 'happy':
    case 'shy':
      return (
        <g className="hearts" fill="#ff6f91">
          <path d="M140 40 c-5 -6 -12 0 0 9 c12 -9 5 -15 0 -9z" />
          <path d="M28 52 c-3 -4 -8 0 0 6 c8 -6 3 -10 0 -6z" />
        </g>
      )
    case 'angry':
      return <text x="124" y="48" fontSize="22">💢</text>
    case 'sick':
      return <path d="M138 62 q-6 10 0 14 q6 -4 0 -14z" fill="#7ec8ff" className="sweat" />
    case 'sad':
      return <path d="M60 98 q-5 9 0 12 q5 -3 0 -12z" fill="#7ec8ff" className="tear" />
    case 'eat':
      return <text x="96" y="122" fontSize="20" className="food">🍙</text>
    case 'bath':
      return (
        <g className="bubbles" fill="rgba(255,255,255,.75)" stroke="#a7d8ff">
          <circle cx="30" cy="70" r="8" />
          <circle cx="140" cy="60" r="10" />
          <circle cx="125" cy="30" r="6" />
          <circle cx="45" cy="35" r="5" />
        </g>
      )
    case 'play':
      return <circle cx="150" cy="122" r="11" fill="#ff8a3d" stroke="#d96a1f" strokeWidth="2" className="ball" />
    case 'work':
      return (
        <g className="laptop">
          <rect x="62" y="112" width="46" height="22" rx="3" fill="#4b5563" />
          <rect x="66" y="115" width="38" height="15" rx="2" fill="#a5f3fc" />
          <rect x="56" y="133" width="58" height="4" rx="2" fill="#374151" />
        </g>
      )
    default:
      return null
  }
}

export interface BlobProps {
  state: PetAnimState
  emotion: Emotion | null
  color: string
  accessory: BlobAccessory
  sleepy?: boolean
  sick?: boolean
  width: number
  height: number
  flip?: boolean
}

export function Blob({ state, emotion, color, accessory, sleepy, sick, width, height, flip }: BlobProps) {
  const { face, mouth } = expression(state, emotion, !!sleepy)
  const body = sick ? shade(color, -0.08) : color
  const id = `g${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const blush = state === 'shy' || emotion === 'shy' || emotion === 'love' ? 0.75 : 0.4
  return (
    <svg
      viewBox="0 0 170 150"
      width={width}
      height={height}
      className={`blob state-${state}`}
      style={{ transform: flip ? 'scaleX(-1)' : undefined, overflow: 'visible' }}
    >
      <defs>
        <radialGradient id={id} cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor={shade(body, 0.18)} />
          <stop offset="65%" stopColor={body} />
          <stop offset="100%" stopColor={shade(body, -0.12)} />
        </radialGradient>
      </defs>
      <ellipse cx="85" cy="141" rx="54" ry="7" className="blob-shadow" />
      <g className="blob-body">
        {accessory === 'cat-ears' && <Accessory kind="cat-ears" color={body} />}
        <path
          d="M24 134 C12 134 10 118 15 100 C22 60 50 32 85 32 C120 32 148 60 155 100 C160 118 158 134 146 134 Z"
          fill={`url(#${id})`}
          stroke={shade(body, -0.28)}
          strokeWidth="3"
        />
        <ellipse cx="58" cy="56" rx="14" ry="8" fill="#fff" opacity="0.55" transform="rotate(-25 58 56)" />
        {sick && <path d="M24 134 C12 134 10 118 15 100 C22 60 50 32 85 32 C120 32 148 60 155 100 C160 118 158 134 146 134 Z" fill="#9be38b" opacity="0.25" />}
        <g className="face">
          <Brows face={face} />
          <Eye x={64} face={face} />
          <Eye x={106} face={face} />
          <ellipse cx="50" cy="100" rx="9" ry="5" fill="#ff8fab" opacity={blush} />
          <ellipse cx="120" cy="100" rx="9" ry="5" fill="#ff8fab" opacity={blush} />
          <MouthShape mouth={mouth} />
        </g>
        {accessory !== 'cat-ears' && accessory !== 'none' && <Accessory kind={accessory} color={body} />}
      </g>
      <Extras state={state} />
    </svg>
  )
}
