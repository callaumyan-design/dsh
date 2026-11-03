/**
 * Live2D (Cubism 4) renderer. Loaded lazily so pets without Live2D never pay for PIXI.
 * The proprietary Cubism Core is supplied by the user (Settings / Appearance) and injected
 * as a <script> before pixi-live2d-display is imported.
 */
import { useEffect, useRef, useState } from 'react'
import * as PIXI from 'pixi.js'
import { install as installUnsafeEval } from '@pixi/unsafe-eval'
import type { Emotion } from '../../core/ai/emotion'
import type { PetAnimState } from '../../core/game/types'
import { live2dMotionFor, type Live2DSpec } from '../../core/pets/pack'

installUnsafeEval({ ShaderSystem: PIXI.ShaderSystem }) // PIXI without eval (our CSP forbids it)
;(window as unknown as { PIXI: typeof PIXI }).PIXI = PIXI

let corePromise: Promise<void> | null = null
function loadCore(url: string): Promise<void> {
  if ((window as unknown as { Live2DCubismCore?: unknown }).Live2DCubismCore) return Promise.resolve()
  corePromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = url
    s.onload = () => resolve()
    s.onerror = () => {
      corePromise = null
      reject(new Error('Live2D Cubism Core 加载失败'))
    }
    document.head.appendChild(s)
  })
  return corePromise
}

type L2DModel = PIXI.Container & {
  internalModel: {
    motionManager: { definitions: Record<string, unknown[]>; state: { currentGroup?: string } }
    coreModel: { setParameterValueById(id: string, v: number): void }
    settings: { expressions?: Array<{ Name: string }> }
    on(ev: string, fn: () => void): void
  }
  motion(group: string, index?: number, priority?: number): Promise<boolean>
  expression(id?: string | number): Promise<boolean>
  focus(x: number, y: number): void
  destroy(opts?: unknown): void
}

interface Props {
  spec: Live2DSpec
  coreUrl: string | null
  state: PetAnimState
  emotion: Emotion | null
  width: number
  height: number
  talking: boolean
}

export default function Live2DView({ spec, coreUrl, state, emotion, width, height, talking }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const modelRef = useRef<L2DModel | null>(null)
  const talkingRef = useRef(talking)
  talkingRef.current = talking
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  // create the PIXI app + model
  useEffect(() => {
    if (!coreUrl) return
    let disposed = false
    let app: PIXI.Application | null = null
    setReady(false)
    setError(null)
    ;(async () => {
      try {
        await loadCore(coreUrl)
        const { Live2DModel } = await import('pixi-live2d-display/cubism4')
        Live2DModel.registerTicker(PIXI.Ticker)
        if (disposed || !canvasRef.current) return
        app = new PIXI.Application({ view: canvasRef.current, width, height, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: window.devicePixelRatio || 1 })
        const model = (await Live2DModel.from(spec.model, { autoInteract: false })) as unknown as L2DModel
        if (disposed) return model.destroy()
        const k = Math.min(width / model.width, height / model.height) * spec.zoom
        model.scale.set(k)
        model.x = (width - model.width) / 2
        model.y = height - model.height + spec.offsetY * height
        app.stage.addChild(model)
        // lip-sync: open/close the mouth while the pet is talking
        let t = 0
        model.internalModel.on('beforeModelUpdate', () => {
          t += 1
          const open = talkingRef.current ? 0.45 + 0.45 * Math.sin(t / 2.2) : 0
          model.internalModel.coreModel.setParameterValueById('ParamMouthOpenY', open)
        })
        modelRef.current = model
        setReady(true)
      } catch (e) {
        console.error('[live2d]', e)
        setError((e as Error).message)
      }
    })()
    return () => {
      disposed = true
      modelRef.current?.destroy({ children: true })
      modelRef.current = null
      app?.destroy(false, { children: true })
    }
  }, [spec.model, coreUrl, width, height, spec.zoom, spec.offsetY])

  // state -> motion
  useEffect(() => {
    const model = modelRef.current
    if (!model || !ready) return
    const groups = Object.keys(model.internalModel.motionManager.definitions ?? {})
    const pick = live2dMotionFor(state, spec, groups)
    if (pick) void model.motion(pick.group, pick.index, state === 'idle' || state === 'walk' || state === 'walk_left' || state === 'sleep' ? 1 : 3)
    model.scale.x = Math.abs(model.scale.x) * (state === 'walk_left' ? -1 : 1)
    if (state === 'walk_left') model.x = (width + model.width) / 2
    else model.x = (width - model.width) / 2
  }, [state, ready, spec, width])

  // emotion -> expression (by explicit map, then by matching name)
  useEffect(() => {
    const model = modelRef.current
    if (!model || !ready) return
    const names = (model.internalModel.settings.expressions ?? []).map((e) => e.Name)
    const key = emotion ?? state
    const wanted = spec.expressions[key] ?? names.find((n) => n.toLowerCase() === String(key).toLowerCase())
    if (wanted) void model.expression(wanted)
  }, [emotion, state, ready, spec])

  // eyes follow the mouse
  useEffect(() => {
    const onMove = (e: MouseEvent) => modelRef.current?.focus(e.clientX, e.clientY)
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  if (!coreUrl) {
    return (
      <div className="l2d-missing" style={{ width, height }}>
        需要 Live2D Cubism Core
        <br />
        面板 → 形象 → 安装 Live2D 运行库
      </div>
    )
  }
  return (
    <div style={{ width, height, position: 'relative' }} data-live2d={ready ? 'ready' : error ? 'error' : 'loading'}>
      <canvas ref={canvasRef} style={{ width, height }} />
      {error && <div className="l2d-missing">Live2D 加载失败：{error}</div>}
    </div>
  )
}
