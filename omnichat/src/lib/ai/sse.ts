export interface SSEEvent {
  event?: string;
  data: string;
}

/** Parses a text/event-stream response body into events. */
export async function* readSSE(res: Response): AsyncGenerator<SSEEvent> {
  if (!res.body) return;
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  let event: string | undefined;
  let data: string[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let start = 0;
      for (let i = 0; i < buf.length; i++) {
        const ch = buf[i];
        if (ch !== '\n' && ch !== '\r') continue;
        if (ch === '\r' && i + 1 >= buf.length) break; // wait to see whether \n follows
        const line = buf.slice(start, i);
        if (ch === '\r' && buf[i + 1] === '\n') i++;
        start = i + 1;
        if (line === '') {
          if (data.length) yield { event, data: data.join('\n') };
          event = undefined;
          data = [];
          continue;
        }
        if (line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon < 0 ? line : line.slice(0, colon);
        let val = colon < 0 ? '' : line.slice(colon + 1);
        if (val.startsWith(' ')) val = val.slice(1);
        if (field === 'data') data.push(val);
        else if (field === 'event') event = val;
      }
      buf = buf.slice(start);
    }
    if (buf.trim()) {
      // Some servers omit the trailing blank line.
      for (const line of buf.split(/\r?\n/)) {
        if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
    }
    if (data.length) yield { event, data: data.join('\n') };
  } finally {
    reader.releaseLock();
  }
}

/** Splits `<think>…</think>` blocks (used by many open models) out of streamed content. */
export function createThinkParser(emit: (d: { content?: string; reasoning?: string }) => void) {
  const OPEN = '<think>';
  const CLOSE = '</think>';
  let mode: 'detect' | 'think' | 'text' = 'detect';
  let buf = '';
  const partialSuffix = (s: string, tag: string) => {
    for (let k = Math.min(tag.length - 1, s.length); k > 0; k--) if (s.endsWith(tag.slice(0, k))) return k;
    return 0;
  };
  return {
    push(chunk: string) {
      buf += chunk;
      while (buf) {
        if (mode === 'detect') {
          const t = buf.trimStart();
          if (!t) return;
          if (t.length < OPEN.length && OPEN.startsWith(t)) return;
          if (t.startsWith(OPEN)) {
            mode = 'think';
            buf = t.slice(OPEN.length);
            continue;
          }
          mode = 'text';
          continue;
        }
        if (mode === 'think') {
          const end = buf.indexOf(CLOSE);
          if (end >= 0) {
            if (end > 0) emit({ reasoning: buf.slice(0, end) });
            buf = buf.slice(end + CLOSE.length).replace(/^\s+/, '');
            mode = 'text';
            continue;
          }
          const keep = partialSuffix(buf, CLOSE);
          const out = buf.slice(0, buf.length - keep);
          if (out) emit({ reasoning: out });
          buf = buf.slice(buf.length - keep);
          return;
        }
        emit({ content: buf });
        buf = '';
        return;
      }
    },
    end() {
      if (buf) emit(mode === 'think' ? { reasoning: buf } : { content: buf });
      buf = '';
    },
  };
}
