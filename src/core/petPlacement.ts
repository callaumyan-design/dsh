/**
 * Where the pet window sits on screen. The window is the pet plus a strip for the speech
 * bubble / input box. Normally the strip is above the pet; near the top of the screen it
 * flips below the pet so the pet can sit right at the top edge and its bubble stays visible.
 * Pure functions so the placement rules are unit-tested; src/main/motion.ts applies them.
 */

/** height of the bubble strip in the pet window */
export const BUBBLE_SPACE = 150

export interface Area {
  x: number
  y: number
  width: number
  height: number
}

export interface Placement {
  x: number
  y: number
  flipped: boolean
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi))

/** screen y of the pet body's top edge for a window at `winY` */
export function petTopOf(winY: number, flipped: boolean): number {
  return flipped ? winY : winY + BUBBLE_SPACE
}

export function winYFor(petTop: number, flipped: boolean): number {
  return flipped ? petTop : petTop - BUBBLE_SPACE
}

/**
 * Bubble below the pet when there is not enough room above it. Two thresholds so a pet
 * sitting right at the boundary does not flip back and forth.
 */
export function shouldFlip(petTop: number, area: Area, flipped: boolean): boolean {
  const room = petTop - area.y
  return flipped ? room < BUBBLE_SPACE + 10 : room < BUBBLE_SPACE * 0.7
}

/**
 * Keep the window where it is, only pulling the pet's body back fully onto the work area,
 * and choose the bubble side. Dropped within `floorSnap` px above the bottom, it lands on it.
 */
export function settleInPlace(win: Placement & { width: number; height: number }, area: Area, floorSnap = 0): Placement {
  const petH = win.height - BUBBLE_SPACE
  const lowest = area.y + area.height - petH
  let top = clamp(petTopOf(win.y, win.flipped), area.y, lowest)
  if (lowest - top <= floorSnap) top = lowest
  const x = clamp(win.x, area.x, area.x + area.width - win.width)
  const flipped = shouldFlip(top, area, win.flipped)
  return { x, y: winYFor(top, flipped), flipped }
}

/** Standing on the bottom of the work area (the taskbar), bubble above. */
export function floorPlacement(win: { x: number; width: number; height: number }, area: Area): Placement {
  return {
    x: clamp(win.x, area.x, area.x + area.width - win.width),
    y: area.y + area.height - win.height,
    flipped: false
  }
}

export function onFloor(win: Placement & { height: number }, area: Area, tolerance = 4): boolean {
  const petBottom = petTopOf(win.y, win.flipped) + win.height - BUBBLE_SPACE
  return Math.abs(petBottom - (area.y + area.height)) <= tolerance
}
