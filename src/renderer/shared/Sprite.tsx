import { useEffect, useState, type CSSProperties } from 'react'
import type { AnimSpec } from '../../core/pets/pack'

interface Props {
  spec: AnimSpec
  width: number
  height: number
  flip?: boolean
  paused?: boolean
}

/** Plays one animation from a pet pack: spritesheet row, frame list, animated image or video. */
export function Sprite({ spec, width, height, flip, paused }: Props) {
  const [frame, setFrame] = useState(0)
  const count = spec.type === 'sheet' ? spec.frames : spec.type === 'frames' ? spec.srcs.length : 1
  const fps = spec.type === 'sheet' || spec.type === 'frames' ? spec.fps : 0
  const loop = spec.type === 'sheet' || spec.type === 'frames' ? spec.loop : true

  useEffect(() => {
    setFrame(0)
    if (!fps || count <= 1 || paused) return
    const t = setInterval(() => setFrame((f) => (f + 1 >= count ? (loop ? 0 : f) : f + 1)), 1000 / fps)
    return () => clearInterval(t)
  }, [spec, fps, count, loop, paused])

  const wrap: CSSProperties = { width, height, transform: flip ? 'scaleX(-1)' : undefined, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }

  if (spec.type === 'sheet') {
    const s = Math.min(width / spec.frameW, height / spec.frameH)
    const w = spec.frameW * s
    const h = spec.frameH * s
    return (
      <div style={wrap}>
        <div
          style={{
            width: w,
            height: h,
            backgroundImage: `url("${spec.src}")`,
            backgroundRepeat: 'no-repeat',
            backgroundSize: `${spec.cols * w}px auto`,
            backgroundPosition: `-${(frame % spec.cols) * w}px -${spec.row * h}px`
          }}
        />
      </div>
    )
  }
  if (spec.type === 'frames') {
    return (
      <div style={wrap}>
        <img src={spec.srcs[frame] ?? spec.srcs[0]} draggable={false} style={{ maxWidth: width, maxHeight: height, objectFit: 'contain' }} alt="" />
      </div>
    )
  }
  if (spec.type === 'video') {
    return (
      <div style={wrap}>
        <video src={spec.src} autoPlay loop={spec.loop} muted playsInline style={{ maxWidth: width, maxHeight: height }} />
      </div>
    )
  }
  return (
    <div style={wrap}>
      <img src={spec.src} draggable={false} style={{ maxWidth: width, maxHeight: height, objectFit: 'contain' }} alt="" />
    </div>
  )
}
