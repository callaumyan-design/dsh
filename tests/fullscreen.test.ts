import { describe, expect, it } from 'vitest'
import { isFullscreen, parseForegroundLine } from '../src/core/fullscreen'

// physical pixels: a 1920x1080@150% laptop panel (2880x1620) and a 1280x1024 monitor to its right
const displays = [
  { x: 0, y: 0, width: 2880, height: 1620 },
  { x: 2880, y: 0, width: 1280, height: 1024 }
]

describe('fullscreen detection', () => {
  it('parses watcher lines', () => {
    expect(parseForegroundLine('0,0,2880,1620,Chrome_WidgetWin_1\r')).toEqual({ left: 0, top: 0, right: 2880, bottom: 1620, className: 'Chrome_WidgetWin_1' })
    expect(parseForegroundLine('garbage')).toBeNull()
  })

  it('detects windows covering a whole display', () => {
    expect(isFullscreen({ left: 0, top: 0, right: 2880, bottom: 1620, className: 'Chrome_WidgetWin_1' }, displays)).toBe(true)
    expect(isFullscreen({ left: -1, top: -1, right: 2881, bottom: 1621, className: 'UnityWndClass' }, displays)).toBe(true)
    expect(isFullscreen({ left: 2880, top: 0, right: 4160, bottom: 1024, className: 'mpv' }, displays)).toBe(true) // second monitor
  })

  it('ignores maximized windows, the desktop and the taskbar', () => {
    expect(isFullscreen({ left: -8, top: -8, right: 2888, bottom: 1548, className: 'Notepad' }, displays)).toBe(false) // maximized, taskbar visible
    expect(isFullscreen({ left: 0, top: 0, right: 2880, bottom: 1620, className: 'Progman' }, displays)).toBe(false)
    expect(isFullscreen({ left: 0, top: 0, right: 2880, bottom: 1620, className: 'WorkerW' }, displays)).toBe(false)
    expect(isFullscreen({ left: 100, top: 100, right: 900, bottom: 700, className: 'Notepad' }, displays)).toBe(false)
  })
})
