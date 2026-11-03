import { lazy, Suspense } from 'react'
import type { Emotion } from '../../core/ai/emotion'
import type { PetAnimState, Stage } from '../../core/game/types'
import { pickAnim, type ResolvedPack } from '../../core/pets/pack'
import type { Settings } from '../../core/settings'
import { Blob, Extras } from './Blob'
import { Sprite } from './Sprite'

const Live2DView = lazy(() => import('./Live2DView'))

interface Props {
  pack: ResolvedPack
  state: PetAnimState
  emotion: Emotion | null
  appearance: Settings['appearance']
  stage: Stage
  width: number
  height: number
  sleepy?: boolean
  sick?: boolean
  /** URL of the Live2D Cubism Core (needed for live2d packs) */
  live2dCore?: string | null
  /** mouth animation for Live2D */
  talking?: boolean
  /** lightweight placeholder for heavy renderers (pack grids) */
  lite?: boolean
}

/** Renders the current pet: the built-in vector slime or a pack animation with fallbacks. */
export function PetView({ pack, state, emotion, appearance, stage, width, height, sleepy, sick, live2dCore, talking, lite }: Props) {
  if (pack.kind === 'live2d' && pack.live2d) {
    if (lite) return <div className="l2d-missing" style={{ width, height }}>🎎 Live2D</div>
    return (
      <Suspense fallback={<div style={{ width, height }} />}>
        <Live2DView spec={pack.live2d} coreUrl={live2dCore ?? null} state={state} emotion={emotion} width={width} height={height} talking={!!talking} />
      </Suspense>
    )
  }
  if (pack.kind === 'builtin') {
    const walkLeft = state === 'walk_left'
    return (
      <Blob
        state={walkLeft ? 'walk' : state}
        emotion={emotion}
        color={appearance.blobColor}
        accessory={appearance.blobAccessory}
        sleepy={sleepy}
        sick={sick}
        width={width}
        height={height}
        flip={walkLeft}
      />
    )
  }
  const picked = pickAnim(pack, state, stage)
  if (!picked) return <div style={{ width, height, display: 'grid', placeItems: 'center', fontSize: 12, color: '#999' }}>（形象包缺少 idle 动画）</div>
  if (pack.procedural) {
    // Static art: the requested state drives CSS motion + SVG effects (hearts, Zzz, sweat ...)
    const motion = state === 'walk_left' ? 'walk' : state
    return (
      <div className={`proc state-${motion}`} style={{ width, height }}>
        <div className="proc-body">
          <Sprite spec={picked.spec} width={width} height={height} flip={picked.flip} />
        </div>
        <svg className="proc-extras" viewBox="0 0 170 150" width={width} height={height}>
          <Extras state={motion} />
        </svg>
      </div>
    )
  }
  return <Sprite spec={picked.spec} width={width} height={height} flip={picked.flip} />
}
