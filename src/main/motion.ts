/**
 * Moves the (small, transparent) pet window around the desktop: dragging with the mouse,
 * idle wandering along the bottom of the work area, and what happens on release:
 * - default: the pet stays where it was put (at any height); a fast fling glides and slows down;
 * - gravity on (appearance.gravity): it falls to the bottom of the screen and bounces.
 * Near the top of the screen the bubble strip flips below the pet (see core/petPlacement).
 */
import { screen, type BrowserWindow, type Rectangle } from 'electron'
import type { MotionEvent } from '../core/ipc'
import { floorPlacement, onFloor, petTopOf, settleInPlace, winYFor, BUBBLE_SPACE, type Placement } from '../core/petPlacement'

const GRAVITY = 2600 // px/s^2
const WALK_SPEED = 55 // px/s
const FRAME_MS = 1000 / 60
/** released faster than this (px/s) without gravity: the pet glides on and slows down */
const FLING_SPEED = 900
const GLIDE_FRICTION = 4 // 1/s
/** dropped this close (px) above the bottom of the screen: land on it, so it can walk again */
const FLOOR_SNAP = 24

export interface SavedPosition {
  x: number
  y: number
  w: number
  h: number
  flipped: boolean
}

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
  private gravity = false
  private flipped = false
  private started = false

  constructor(
    private readonly win: BrowserWindow,
    private readonly emit: (e: MotionEvent) => void,
    private readonly onSettledCb: (p: SavedPosition) => void
  ) {
    const b = win.getBounds()
    this.x = b.x
    this.y = b.y
  }

  start(): void {
    this.started = true
    this.settle()
    this.scheduleDecision(3000)
  }

  /** Gravity on: drop to the bottom now. Off: stay wherever the pet is. */
  setGravity(on: boolean): void {
    if (on === this.gravity) return
    this.gravity = on
    if (on && this.started && this.mode === 'idle' && !this.win.isDestroyed()) {
      this.vx = 0
      this.vy = 0
      this.fall()
    }
  }

  stop(): void {
    this.stopLoop()
    if (this.decideTimer) clearTimeout(this.decideTimer)
  }

  get current(): MotionEvent {
    return { mode: this.mode, dir: this.dir, flip: this.flipped }
  }

  private area(): Rectangle {
    return screen.getDisplayMatching(this.win.getBounds()).workArea
  }

  private floorY(area = this.area()): number {
    return area.y + area.height - this.win.getBounds().height
  }

  private rect(): Placement & { width: number; height: number } {
    const b = this.win.getBounds()
    return { x: this.x, y: this.y, flipped: this.flipped, width: b.width, height: b.height }
  }

  private setMode(mode: MotionEvent['mode'], dir = this.dir): void {
    if (mode === this.mode && dir === this.dir) return
    this.mode = mode
    this.dir = dir
    this.emit(this.current)
  }

  private apply(): void {
    if (this.win.isDestroyed()) return
    this.win.setPosition(Math.round(this.x), Math.round(this.y))
  }

  private place(p: Placement): void {
    this.x = p.x
    this.y = p.y
    if (p.flipped !== this.flipped) {
      this.flipped = p.flipped
      this.emit(this.current)
    }
    this.apply()
  }

  /** gravity: stand on the bottom of the screen; otherwise stay put, fully on screen */
  private settle(): void {
    if (this.win.isDestroyed()) return
    const area = this.area()
    this.place(this.gravity ? floorPlacement(this.rect(), area) : settleInPlace(this.rect(), area, FLOOR_SNAP))
  }

  private onSettled(): void {
    const b = this.win.getBounds()
    this.onSettledCb({ x: Math.round(this.x), y: Math.round(this.y), w: b.width, h: b.height, flipped: this.flipped })
  }

  private land(): void {
    this.stopLoop()
    this.vx = 0
    this.vy = 0
    this.settle()
    this.setMode('idle')
    this.onSettled()
    this.scheduleDecision()
  }

  setPaused(reason: PauseReason, on: boolean): void {
    if (on) {
      this.pauses.add(reason)
      if (this.mode === 'walk') {
        this.stopLoop()
        this.setMode('idle')
        this.onSettled()
      }
    } else {
      this.pauses.delete(reason)
    }
    // walkTo() does not keep a decision pending, so make sure one is queued again
    if (this.mode === 'idle' && !this.decideTimer) this.scheduleDecision()
  }

  /** Restore the remembered window (same size, so the pet lands exactly where it was) or start bottom-right. */
  placeInitial(saved: { x: number | null; y: number | null; w?: number | null; h?: number | null; flipped?: boolean }): void {
    const b = this.win.getBounds()
    const w = saved.w || b.width
    const h = saved.h || b.height
    let area = screen.getPrimaryDisplay().workArea
    if (saved.x != null && saved.y != null) {
      this.flipped = !!saved.flipped
      area = screen.getDisplayNearestPoint({ x: saved.x + w / 2, y: petTopOf(saved.y, this.flipped) + (h - BUBBLE_SPACE) / 2 }).workArea
      this.x = saved.x
      this.y = saved.y
    } else {
      this.flipped = false
      this.x = area.x + area.width - w - 80
      this.y = area.y + area.height - h
    }
    this.win.setBounds({ x: Math.round(this.x), y: Math.round(this.y), width: w, height: h })
    const rect = { x: this.x, y: this.y, flipped: this.flipped, width: w, height: h }
    this.place(this.gravity ? floorPlacement(rect, area) : settleInPlace(rect, area, FLOOR_SNAP))
  }

  /** Resize the window keeping the pet where it is: its bottom (bubble above) or its top (bubble below). */
  resize(width: number, height: number): void {
    const b = this.win.getBounds()
    if (b.width === width && b.height === height) return
    this.x = Math.round(this.x + b.width / 2 - width / 2)
    if (!this.flipped) this.y = Math.round(this.y + b.height - height)
    this.win.setBounds({ x: Math.round(this.x), y: Math.round(this.y), width, height })
    if (this.mode === 'idle') this.settle()
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
    if (this.gravity) this.fall()
    else if (Math.hypot(this.vx, this.vy) > FLING_SPEED) this.glide()
    else this.land()
  }

  /** Thrown without gravity: slide on, bounce off the screen edges, slow down, stop. */
  private glide(): void {
    this.setMode('fall')
    this.startLoop((dt) => {
      const area = this.area()
      const b = this.win.getBounds()
      const k = Math.exp(-GLIDE_FRICTION * dt)
      this.vx *= k
      this.vy *= k
      this.x += this.vx * dt
      this.y += this.vy * dt
      const maxX = area.x + area.width - b.width
      if (this.x < area.x || this.x > maxX) {
        this.x = Math.min(Math.max(this.x, area.x), maxX)
        this.vx = -this.vx * 0.5
      }
      // the pet's body bounces, not the transparent bubble strip
      const top = petTopOf(this.y, this.flipped)
      const bottom = area.y + area.height - (b.height - BUBBLE_SPACE)
      if (top < area.y || top > bottom) {
        this.y = winYFor(Math.min(Math.max(top, area.y), bottom), this.flipped)
        this.vy = -this.vy * 0.5
      }
      this.apply()
      if (Math.hypot(this.vx, this.vy) < 40) this.land()
    })
  }

  private fall(): void {
    if (this.flipped) {
      // falling needs the bubble strip above the pet again; keep the pet itself in place
      this.y = winYFor(petTopOf(this.y, true), false)
      this.flipped = false
      this.emit(this.current)
      this.apply()
    }
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
          this.onSettled()
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
        this.onSettled()
        this.scheduleDecision()
      }
    }, 1000 / 30)
  }

  private decide(): void {
    this.decideTimer = null
    if (this.pauses.size || this.mode !== 'idle' || this.win.isDestroyed() || !this.win.isVisible()) return this.scheduleDecision()
    const area = this.area()
    const b = this.win.getBounds()
    this.x = b.x
    this.y = b.y
    // screens can change under the pet (resolution, unplugged monitor): put it back on one
    const before = `${this.x},${this.y},${this.flipped}`
    this.settle()
    if (`${this.x},${this.y},${this.flipped}` !== before) this.onSettled()
    // it only wanders while standing on the bottom of the screen; put somewhere else, it stays there
    if (onFloor(this.rect(), area) && Math.random() < 0.45) {
      const minX = area.x
      const maxX = area.x + area.width - b.width
      const from = this.x
      let target = minX + Math.random() * (maxX - minX)
      if (Math.abs(target - from) < 80) target = from + (target < from ? -120 : 120)
      target = Math.min(Math.max(target, minX), maxX)
      // keep walks short so the pet does not cross the whole screen
      const maxDist = Math.min(400, area.width / 3)
      if (Math.abs(target - from) > maxDist) target = from + Math.sign(target - from) * maxDist
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
