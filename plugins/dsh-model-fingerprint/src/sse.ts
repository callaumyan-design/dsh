/** Minimal Server-Sent Events parser (WHATWG event-stream framing). */

export interface SseEvent {
  event?: string
  data: string
  /** Milliseconds since the request started, when the event was dispatched. */
  at: number
}

/** Incremental parser; feed decoded text, collect dispatched events. */
export class SseParser {
  private buffer = ''
  private dataLines: string[] = []
  private eventName: string | undefined

  constructor(private readonly onEvent: (event: Omit<SseEvent, 'at'>) => void) {}

  push(text: string): void {
    this.buffer += text
    for (;;) {
      const idx = this.buffer.search(/\r\n|\r|\n/)
      if (idx < 0) break
      const line = this.buffer.slice(0, idx)
      const nlLen = this.buffer.startsWith('\r\n', idx) ? 2 : 1
      this.buffer = this.buffer.slice(idx + nlLen)
      this.line(line)
    }
  }

  end(): void {
    if (this.buffer.length > 0) this.line(this.buffer)
    this.buffer = ''
    this.dispatch()
  }

  private line(line: string): void {
    if (line === '') { this.dispatch(); return }
    if (line.startsWith(':')) return
    const colon = line.indexOf(':')
    const field = colon < 0 ? line : line.slice(0, colon)
    let value = colon < 0 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') this.dataLines.push(value)
    else if (field === 'event') this.eventName = value
  }

  private dispatch(): void {
    if (this.dataLines.length === 0) { this.eventName = undefined; return }
    this.onEvent({ ...this.eventName !== undefined ? { event: this.eventName } : {}, data: this.dataLines.join('\n') })
    this.dataLines = []
    this.eventName = undefined
  }
}

/** Read a whole SSE body, stamping each event with its arrival time relative to `startedAt`. */
export async function readSse(body: ReadableStream<Uint8Array>, startedAt: number, maxBytes = 4 * 1024 * 1024): Promise<SseEvent[]> {
  const events: SseEvent[] = []
  const parser = new SseParser(e => events.push({ ...e, at: performance.now() - startedAt }))
  const decoder = new TextDecoder()
  let bytes = 0
  const reader = body.getReader()
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maxBytes) throw new Error(`stream exceeded ${maxBytes} bytes`)
      parser.push(decoder.decode(value, { stream: true }))
    }
    parser.push(decoder.decode())
    parser.end()
  } finally {
    reader.releaseLock()
  }
  return events
}
