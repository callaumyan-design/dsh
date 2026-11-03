/** Mirror console output into <data>/logs/main.log (rotated at 2 MB) for troubleshooting. */
import fs from 'node:fs'
import path from 'node:path'
import { format } from 'node:util'

const MAX = 2 * 1024 * 1024
let file = ''

/** Redact anything that looks like an API key before it reaches the disk. */
export function redact(s: string): string {
  return s.replace(/\b(sk-(?:ant-)?[A-Za-z0-9_-]{8})[A-Za-z0-9_-]{8,}/g, '$1…').replace(/(Bearer\s+)[A-Za-z0-9._-]{12,}/gi, '$1…')
}

function write(level: string, args: unknown[]): void {
  if (!file) return
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > MAX) fs.renameSync(file, file.replace(/\.log$/, '.old.log'))
    fs.appendFileSync(file, `${new Date().toISOString()} [${level}] ${redact(format(...args))}\n`)
  } catch {
    /* never let logging crash the app */
  }
}

export function installLogger(dataDir: string): string {
  const dir = path.join(dataDir, 'logs')
  fs.mkdirSync(dir, { recursive: true })
  file = path.join(dir, 'main.log')
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    const orig = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      orig(...args)
      write(level, args)
    }
  }
  process.on('uncaughtException', (e) => console.error('[uncaught]', e))
  process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e))
  return dir
}
