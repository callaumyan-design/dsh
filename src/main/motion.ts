/**
 * Moves the (small, transparent) pet window around the desktop: idle wandering along the
 * bottom of the work area, dragging with the mouse, and a throw/fall with gravity on release.
 */
import { screen, type BrowserWindow, type Rectangle } from 'electron'
import type { MotionEvent } from '../core/ipc'

const GRAVITY = 2600 // px/s^2
const WALK_SPEED = 55 // px/s
const FRAME_MS = 1000 / 60

export type PauseReason = 'chat' | 'input' | 'menu' | 'sleep' | 'disabled' | 'hidden' | 'anim' | 'focus'

export class PetMotion {
  private mode: MotionEvent['mode'] = 'idle'
  private dir: MotionEvent['dir'] = 'right'
  private loopTimer: NodeJS.Timeout | null = null
  private decideTimer: NodeJS.Timeout | null = null
  private pauses = new Set<PauseReason>()
  private x = 0
  private y = 0
  private vx = 0
  private vy = 0
  private targetX = 0
  private offset = { x: 0, y: 0 }
  private samples: Array<{ x: number; y: number; t: number }> = []
  private lastStep = 0

  constructor(
    private readonly win: BrowserWindow,
    private readonly emit: (e: MotionEvent) => void,
    private readonly onSettled: (x: number, y: number) => void
  ) {
    const b = win.getBounds()
    this.x = b.x
    this.y = b.y
  }

  start(): void {
    this.snapToFloor()
    this.scheduleDecision(3000)
  }

  stop(): void {
    this.stopLoop()
    if (this.decideTimer) clearTimeout(this.decideTimer)
  }

  get current(): MotionEvent {
    return { mode: this.mode, dir: this.dir }
  }

  private area(): Rectangle {
    return screen.getDisplayMatching(this.win.getBounds()).workArea
  }

  private floorY(area = this.area()): number {
    return area.y + area.height - this.win.getBounds().height
  }

  private setMode(mode: MotionEvent['mode'], dir = this.dir): void {
    if (mode === this.mode && dir === this.dir) return
    this.mode = mode
    this.dir = dir
    this.emit({ mode, dir })
  }

  private apply(): void {
    if (this.win.isDestroyed()) return
    this.win.setPosition(Math.round(this.x), Math.round(this.y))
  }

  setPaused(reason: PauseReason, on: boolean): void {
    if (on) {
      this.pauses.add(reason)
      if (this.mode === 'walk') {
        this.stopLoop()
        this.setMode('idle')
      }
    } else {
      this.pauses.delete(reason)
    }
  }

  /** Put the window at a remembered position (clamped on screen) or bottom-right by default. */
  placeInitial(x: number | null, y: number | null): void {
    const b = this.win.getBounds()
    let area = screen.getPrimaryDisplay().workArea
    if (x !== null && y !== null) {
      const d = screen.getDisplayNearestPoint({ x: x + b.width / 2, y: y + b.height / 2 })
      area = d.workArea
      this.x = Math.min(Math.max(x, area.x), area.x + area.width - b.width)
    } else {
      this.x = area.x + area.width - b.width - 80
    }
    this.y = area.y + area.height - b.height
    this.apply()
  }

  snapToFloor(): void {
    const area = this.area()
    const b = this.win.getBounds()
    this.x = Math.min(Math.max(b.x, area.x), area.x + area.width - b.width)
    this.y = this.floorY(area)
    this.apply()
  }

  /** Resize the window keeping its bottom-center anchored. */
  resize(width: number, height: number): void {
    const b = this.win.getBounds()
    if (b.width === width && b.height === height) return
    const cx = b.x + b.width / 2
    const bottom = b.y + b.height
    this.x = Math.round(cx - width / 2)
    this.y = Math.round(bottom - height)
    this.win.setBounds({ x: Math.round(this.x), y: Math.round(this.y), width, height })
    if (this.mode === 'idle') this.snapToFloor()
  }

  dragStart(): void {
    this.stopLoop()
    const c = screen.getCursorScreenPoint()
    const b = this.win.getBounds()
    this.offset = { x: c.x - b.x, y: c.y - b.y }
    this.samples = [{ x: b.x, y: b.y, t: Date.now() }]
    this.setMode('drag')
    this.startLoop(() => {
      const p = screen.getCursorScreenPoint()
      this.x = p.x - this.offset.x
      this.y = p.y - this.offset.y
      this.apply()
      const t = Date.now()
      this.samples.push({ x: this.x, y: this.y, t })
      while (this.samples.length > 2 && t - this.samples[0].t > 100) this.samples.shift()
    })
  }

  dragEnd(): void {
    if (this.mode !== 'drag') return
    this.stopLoop()
    const first = this.samples[0]
    const last = this.samples[this.samples.length - 1]
    const dt = Math.max(16, (last?.t ?? 0) - (first?.t ?? 0)) / 1000
    this.vx = first && last ? Math.max(-2500, Math.min(2500, (last.x - first.x) / dt)) : 0
    this.vy = first && last ? Math.max(-2500, Math.min(2500, (last.y - first.y) / dt)) : 0
    this.fall()
  }

  private fall(): void {
    this.setMode('fall')
    this.startLoop((dt) => {
      const area = this.area()
      const w = this.win.getBounds().width
      const floor = this.floorY(area)
      this.vy += GRAVITY * dt
      this.x += this.vx * dt
      this.y += this.vy * dt
      if (this.x < area.x) {
        this.x = area.x
        this.vx = -this.vx * 0.5
      } else if (this.x > area.x + area.width - w) {
        this.x = area.x + area.width - w
        this.vx = -this.vx * 0.5
      }
      if (this.y >= floor) {
        this.y = floor
        if (this.vy > 500) {
          this.vy = -this.vy * 0.3
          this.vx *= 0.6
        } else {
          this.vx = 0
          this.vy = 0
          this.apply()
          this.stopLoop()
          this.setMode('idle')
          this.onSettled(this.x, this.y)
          this.scheduleDecision()
          return
        }
      }
      this.apply()
    })
  }

  private walkTo(targetX: number): void {
    this.targetX = targetX
    const dir = targetX < this.x ? 'left' : 'right'
    this.setMode('walk', dir)
    this.startLoop((dt) => {
      const step = WALK_SPEED * dt * (dir === 'left' ? -1 : 1)
      this.x += step
      const arrived = dir === 'left' ? this.x <= this.targetX : this.x >= this.targetX
      if (arrived) this.x = this.targetX
      this.apply()
      if (arrived) {
        this.stopLoop()
        this.setMode('idle')
        this.onSettled(this.x, this.y)
        this.scheduleDecision()
      }
    }, 1000 / 30)
  }

  private decide(): void {
    if (this.pauses.size || this.mode !== 'idle' || this.win.isDestroyed() || !this.win.isVisible()) return this.scheduleDecision()
    const area = this.area()
    const b = this.win.getBounds()
    if (Math.abs(b.y - this.floorY(area)) > 4) this.snapToFloor()
    if (Math.random() < 0.45) {
      const minX = area.x
      const maxX = area.x + area.width - b.width
      let target = minX + Math.random() * (maxX - minX)
      if (Math.abs(target - b.x) < 80) target = b.x + (target < b.x ? -120 : 120)
      target = Math.min(Math.max(target, minX), maxX)
      // keep walks short so the pet does not cross the whole screen
      const maxDist = Math.min(400, area.width / 3)
      if (Math.abs(target - b.x) > maxDist) target = b.x + Math.sign(target - b.x) * maxDist
      this.x = b.x
      this.y = b.y
      this.walkTo(target)
      return
    }
    this.scheduleDecision()
  }

  private scheduleDecision(delay = 4000 + Math.random() * 8000): void {
    if (this.decideTimer) clearTimeout(this.decideTimer)
    this.decideTimer = setTimeout(() => this.decide(), delay)
  }

  private startLoop(step: (dt: number) => void, interval = FRAME_MS): void {
    this.stopLoop()
    this.lastStep = Date.now()
    this.loopTimer = setInterval(() => {
      const now = Date.now()
      const dt = Math.min(0.05, (now - this.lastStep) / 1000)
      this.lastStep = now
      step(dt)
    }, interval)
  }

  private stopLoop(): void {
    if (this.loopTimer) clearInterval(this.loopTimer)
    this.loopTimer = null
  }
}
