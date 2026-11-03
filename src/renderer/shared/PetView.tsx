import type { Emotion } from '../../core/ai/emotion'
import type { PetAnimState, Stage } from '../../core/game/types'
import { pickAnim, type ResolvedPack } from '../../core/pets/pack'
import type { Settings } from '../../core/settings'
import { Blob } from './Blob'
import { Sprite } from './Sprite'

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
}

/** Renders the current pet: the built-in vector slime or a pack animation with fallbacks. */
export function PetView({ pack, state, emotion, appearance, stage, width, height, sleepy, sick }: Props) {
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
  return <Sprite spec={picked.spec} width={width} height={height} flip={picked.flip} />
}
