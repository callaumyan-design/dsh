/**
 * Minimal Server-Sent Events reader for fetch() response bodies.
 * Yields the `data:` payload of each event (multi-line data joined with "\n").
 */
export async function* readSSE(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let data: string[] = []
  const flushEvent = function* () {
    if (data.length) {
      yield data.join('\n')
      data = []
    }
  }
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        let line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        if (line.endsWith('\r')) line = line.slice(0, -1)
        if (line === '') {
          yield* flushEvent()
          continue
        }
        if (line.startsWith(':')) continue
        const colon = line.indexOf(':')
        const field = colon === -1 ? line : line.slice(0, colon)
        let value = colon === -1 ? '' : line.slice(colon + 1)
        if (value.startsWith(' ')) value = value.slice(1)
        if (field === 'data') data.push(value)
      }
    }
    buf += decoder.decode()
    if (buf.startsWith('data:')) data.push(buf.slice(5).trimStart())
    yield* flushEvent()
  } finally {
    reader.releaseLock()
  }
}
