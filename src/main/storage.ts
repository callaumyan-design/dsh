import fs from 'node:fs'
import path from 'node:path'
import type { StoredMessage } from '../core/ipc'
import { dateKey } from '../core/util'

/** Write atomically: temp file + rename, so a crash never leaves a half-written save. */
export function writeFileAtomic(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, content, 'utf8')
  fs.renameSync(tmp, file)
}

export class JsonFile<T> {
  data: T
  private timer: NodeJS.Timeout | null = null

  constructor(
    readonly file: string,
    normalize: (raw: unknown) => T
  ) {
    let raw: unknown = undefined
    if (fs.existsSync(file)) {
      try {
        raw = JSON.parse(fs.readFileSync(file, 'utf8'))
      } catch (e) {
        const bad = `${file}.corrupt-${Date.now()}`
        try {
          fs.renameSync(file, bad)
        } catch {
          /* ignore */
        }
        console.error(`[storage] ${path.basename(file)} is corrupt, moved to ${bad}:`, e)
      }
    }
    this.data = normalize(raw)
  }

  set(next: T): void {
    this.data = next
    this.scheduleSave()
  }

  update(fn: (d: T) => T): T {
    this.set(fn(this.data))
    return this.data
  }

  scheduleSave(delay = 400): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), delay)
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    try {
      writeFileAtomic(this.file, JSON.stringify(this.data, null, 2))
    } catch (e) {
      console.error(`[storage] failed to write ${this.file}:`, e)
    }
  }
}

/** Chat history: one JSONL file per day, plus an in-memory tail for prompts and the UI. */
export class ChatLog {
  private tail: StoredMessage[] = []

  constructor(
    private readonly dir: string,
    private readonly keep = 300
  ) {
    fs.mkdirSync(dir, { recursive: true })
    const files = this.dayFiles().slice(-7)
    for (const f of files) this.tail.push(...this.readFile(path.join(dir, f)))
    this.tail = this.tail.slice(-keep)
  }

  private dayFiles(): string[] {
    return fs
      .readdirSync(this.dir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .sort()
  }

  private readFile(file: string): StoredMessage[] {
    try {
      return fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l) as StoredMessage
          } catch {
            return null
          }
        })
        .filter((m): m is StoredMessage => !!m && typeof m.content === 'string')
    } catch {
      return []
    }
  }

  append(msg: StoredMessage): void {
    this.tail.push(msg)
    if (this.tail.length > this.keep) this.tail.splice(0, this.tail.length - this.keep)
    try {
      fs.appendFileSync(path.join(this.dir, `${dateKey(msg.ts)}.jsonl`), JSON.stringify(msg) + '\n', 'utf8')
    } catch (e) {
      console.error('[chat] append failed', e)
    }
  }

  recent(limit = 100): StoredMessage[] {
    return this.tail.slice(-limit)
  }

  readDay(date: string): StoredMessage[] {
    const f = path.join(this.dir, `${date}.jsonl`)
    return fs.existsSync(f) ? this.readFile(f) : []
  }

  clear(): void {
    for (const f of this.dayFiles()) fs.rmSync(path.join(this.dir, f), { force: true })
    this.tail = []
  }
}
