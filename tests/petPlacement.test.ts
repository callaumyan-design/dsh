import { describe, expect, it } from 'vitest'
import { BUBBLE_SPACE, floorPlacement, onFloor, petTopOf, settleInPlace, shouldFlip } from '../src/core/petPlacement'

const area = { x: 0, y: 0, width: 1920, height: 1040 } // 1080p minus a 40px taskbar
const W = 240
const H = BUBBLE_SPACE + 130 // pet body 130px tall

describe('pet placement', () => {
  it('stays where it was dropped in the middle of the screen', () => {
    const p = settleInPlace({ x: 600, y: 300, flipped: false, width: W, height: H }, area)
    expect(p).toEqual({ x: 600, y: 300, flipped: false })
  })

  it('can sit right at the top of the screen: the bubble moves below the pet', () => {
    // dragged so high that the pet body pokes 20px above the screen
    const p = settleInPlace({ x: 600, y: -BUBBLE_SPACE - 20, flipped: false, width: W, height: H }, area)
    expect(p.flipped).toBe(true)
    expect(petTopOf(p.y, p.flipped)).toBe(0)
    expect(p.y).toBe(0) // flipped: the window starts with the pet
  })

  it('keeps the pet body on screen at the bottom and the sides', () => {
    const low = settleInPlace({ x: -50, y: 2000, flipped: false, width: W, height: H }, area)
    expect(low.x).toBe(0)
    expect(petTopOf(low.y, low.flipped) + H - BUBBLE_SPACE).toBe(1040)
    const right = settleInPlace({ x: 5000, y: 300, flipped: false, width: W, height: H }, area)
    expect(right.x).toBe(1920 - W)
  })

  it('lands on the taskbar when dropped just above it', () => {
    const floorY = 1040 - H
    expect(settleInPlace({ x: 10, y: floorY - 20, flipped: false, width: W, height: H }, area, 24).y).toBe(floorY)
    expect(settleInPlace({ x: 10, y: floorY - 60, flipped: false, width: W, height: H }, area, 24).y).toBe(floorY - 60)
  })

  it('does not flip back and forth at the boundary', () => {
    const room = BUBBLE_SPACE * 0.7 + 5
    expect(shouldFlip(room, area, false)).toBe(false)
    expect(shouldFlip(room, area, true)).toBe(true)
    expect(shouldFlip(BUBBLE_SPACE + 20, area, true)).toBe(false)
  })

  it('works on a second monitor above the first', () => {
    const top = { x: 0, y: -1080, width: 1920, height: 1080 }
    const p = settleInPlace({ x: 100, y: -1080 - 100, flipped: false, width: W, height: H }, top)
    expect(p.flipped).toBe(true)
    expect(petTopOf(p.y, p.flipped)).toBe(-1080 - 100 + BUBBLE_SPACE) // already on that screen: unchanged, only the bubble flips
  })

  it('floor placement and detection', () => {
    const f = floorPlacement({ x: 100, width: W, height: H }, area)
    expect(f).toEqual({ x: 100, y: 1040 - H, flipped: false })
    expect(onFloor({ ...f, height: H }, area)).toBe(true)
    expect(onFloor({ x: 100, y: 300, flipped: false, height: H }, area)).toBe(false)
  })
})
