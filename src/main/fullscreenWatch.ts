/**
 * Windows-only: one long-lived PowerShell process reports the foreground window; when it
 * covers a whole display the pet hides, and comes back when the fullscreen app is gone.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { screen } from 'electron'
import { isFullscreen, parseForegroundLine, WINDOWS_WATCH_SCRIPT } from '../core/fullscreen'

export class FullscreenWatcher {
  private proc: ChildProcess | null = null
  private buf = ''
  private state = false
  private restarts = 0
  lastProbeAt = 0
  lastLine = ''

  constructor(private readonly onChange: (fullscreen: boolean) => void) {}

  get supported(): boolean {
    return process.platform === 'win32'
  }

  start(): void {
    if (!this.supported || this.proc) return
    if (this.restarts >= 99) this.restarts = 0
    const encoded = Buffer.from(WINDOWS_WATCH_SCRIPT, 'utf16le').toString('base64')
    try {
      this.proc = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (e) {
      console.warn('[fullscreen] cannot start watcher', e)
      return
    }
    this.proc.stdout?.setEncoding('utf8')
    this.proc.stdout?.on('data', (chunk: string) => {
      this.buf += chunk
      let nl: number
      while ((nl = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, nl)
        this.buf = this.buf.slice(nl + 1)
        this.handle(line)
      }
    })
    this.proc.stderr?.on('data', (d) => console.warn('[fullscreen]', String(d).slice(0, 300)))
    this.proc.on('exit', (code) => {
      this.proc = null
      if (this.state) this.set(false)
      // restart a few times if PowerShell dies unexpectedly
      if (code !== null && this.restarts++ < 3) setTimeout(() => this.start(), 10_000)
    })
  }

  get running(): boolean {
    return !!this.proc
  }

  get fullscreen(): boolean {
    return this.state
  }

  stop(): void {
    this.restarts = 99
    this.proc?.kill()
    this.proc = null
    if (this.state) this.set(false)
  }

  private handle(line: string): void {
    const fg = parseForegroundLine(line)
    if (!fg) return
    this.lastProbeAt = Date.now()
    this.lastLine = line.trim()
    // physical-pixel display rects (dipToScreenRect is Windows-only, like this watcher)
    const displays = screen.getAllDisplays().map((d) => screen.dipToScreenRect(null, d.bounds))
    this.set(isFullscreen(fg, displays))
  }

  private set(v: boolean): void {
    if (v === this.state) return
    this.state = v
    this.onChange(v)
  }
}
