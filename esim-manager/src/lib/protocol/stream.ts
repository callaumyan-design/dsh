/**
 * BLE 通知流 → JSON 消息 的增量解析器。
 *
 * 固件（ble_sim_uart_tt.cpp: ble_send_data）把每条消息按 256 字节切段，逐段
 * notify()，消息之间 **没有任何分隔符或长度头**。因此：
 * - 一次通知可能只是半条消息，也可能（理论上，若协议栈合并）包含多条；
 * - UTF-8 多字节字符可能被切在两次通知之间；
 * - getElpaInfo / cardStatus 用 cJSON_Print 输出，带换行和制表符；
 *   lpa / progress 用 cJSON_PrintUnformatted 输出，没有空白。
 *
 * 本解析器逐字符跟踪 `{}`/`[]` 嵌套深度与字符串/转义状态，在顶层对象闭合时切出
 * 一条消息再交给 JSON.parse。顶层只认 `{` 开头（设备只发对象）。
 *
 * 如果 MTU 太小导致协议栈截断通知，括号永远不会配平。为避免一条坏消息吞掉
 * 后续所有消息，当新的一次通知以已知消息前缀（`{"type":` / `{"cmd":` 等）开头、
 * 而解析器里还有未完成的消息时，把未完成部分作为 `truncated` 事件丢弃并重新同步。
 */

export type StreamEvent =
  | { kind: 'json'; value: unknown; text: string }
  /** 括号已配平但 JSON.parse 失败。 */
  | { kind: 'invalid'; text: string; error: string }
  /**
   * 未完成或不完整的消息被丢弃：
   * - resync：新消息开头到了而上一条还没闭合；
   * - flush：长时间没有后续数据；
   * - overflow：超过缓冲上限；
   * - chunk-gap：括号配平且能解析，但分片长度不符合固件的分段规律
   *   （中间分片不是 256 字节），说明有数据在协议栈被截断——即使 JSON 恰好仍然合法，
   *   内容也不可信。
   */
  | { kind: 'truncated'; text: string; reason: 'resync' | 'flush' | 'overflow' | 'chunk-gap'; chunkSizes?: number[] }
  /** 顶层对象之外的非空白文本。 */
  | { kind: 'text'; text: string };

export interface JsonStreamOptions {
  /** 缓冲区上限（字符数），超过则丢弃未完成消息。默认 1 MiB。 */
  maxBuffer?: number;
  /** 判断一次通知是否是一条新消息的开头。设为 null 关闭重新同步。 */
  messageStart?: RegExp | null;
  /**
   * 固件发送时的分段大小（旧版 eLPA 为 256）。设置后，跨多个分片的消息要求除最后一片外
   * 每片都恰好是这个长度，否则判定为被截断。null 关闭该检查。
   */
  firmwareChunkSize?: number | null;
}

export const DEFAULT_MESSAGE_START = /^\{\s*"(?:type|cmd|data|error)"\s*:/;

export class JsonMessageStream {
  private decoder = new TextDecoder('utf-8');
  private buf = '';
  private pos = 0;
  private depth = 0;
  private inString = false;
  private escape = false;
  private start = -1;
  private pendingSinceTs: number | null = null;
  private readonly maxBuffer: number;
  private readonly messageStart: RegExp | null;
  private firmwareChunkSize: number | null;
  /** 当前消息涉及的各分片长度（只在 push 字节时记录）。 */
  private msgChunks: number[] = [];
  private currentChunkSize: number | null = null;

  constructor(options: JsonStreamOptions = {}) {
    this.maxBuffer = options.maxBuffer ?? 1024 * 1024;
    this.messageStart = options.messageStart === undefined ? DEFAULT_MESSAGE_START : options.messageStart;
    this.firmwareChunkSize = options.firmwareChunkSize ?? null;
  }

  setFirmwareChunkSize(size: number | null) {
    this.firmwareChunkSize = size;
  }

  /** 是否有未完成的消息。 */
  get hasPending(): boolean {
    return this.start >= 0;
  }

  /** 未完成消息开始累积的时间戳（ms）。 */
  get pendingSince(): number | null {
    return this.hasPending ? this.pendingSinceTs : null;
  }

  /** 未完成消息当前长度（字符）。 */
  get pendingLength(): number {
    return this.hasPending ? this.buf.length - this.start : 0;
  }

  /** 推入一次通知的原始字节。 */
  push(chunk: Uint8Array, now: number = Date.now()): StreamEvent[] {
    const events: StreamEvent[] = [];
    if (this.hasPending && this.messageStart && this.looksLikeMessageStart(chunk)) {
      // 新消息开头到了，但上一条还没闭合：上一条已经不完整了。
      const rest = this.decoder.decode();
      this.decoder = new TextDecoder('utf-8');
      events.push(...this.discardPending('resync', rest));
    }
    if (this.hasPending) this.msgChunks.push(chunk.length);
    this.currentChunkSize = chunk.length;
    const text = this.decoder.decode(chunk, { stream: true });
    events.push(...this.feed(text, now));
    this.currentChunkSize = null;
    return events;
  }

  /** 推入已解码的文本（测试或其他传输使用，不做分片检查）。 */
  pushText(text: string, now: number = Date.now()): StreamEvent[] {
    return this.feed(text, now);
  }

  /** 丢弃未完成的消息（例如超时）。 */
  flush(): StreamEvent[] {
    const rest = this.decoder.decode();
    this.decoder = new TextDecoder('utf-8');
    if (!this.hasPending) {
      const junk = (this.buf.slice(this.pos) + rest).trim();
      this.resetState();
      return junk ? [{ kind: 'text', text: junk }] : [];
    }
    return this.discardPending('flush', rest);
  }

  /** 清空所有状态（断开连接时调用）。 */
  reset(): void {
    this.decoder = new TextDecoder('utf-8');
    this.resetState();
  }

  private resetState() {
    this.buf = '';
    this.pos = 0;
    this.depth = 0;
    this.inString = false;
    this.escape = false;
    this.start = -1;
    this.pendingSinceTs = null;
    this.msgChunks = [];
  }

  private looksLikeMessageStart(chunk: Uint8Array): boolean {
    if (!this.messageStart || chunk.length === 0 || chunk[0] !== 0x7b /* { */) return false;
    const head = new TextDecoder('utf-8').decode(chunk.subarray(0, Math.min(chunk.length, 24)));
    return this.messageStart.test(head);
  }

  private discardPending(reason: 'resync' | 'flush' | 'overflow', extra = ''): StreamEvent[] {
    const text = this.hasPending ? this.buf.slice(this.start) + extra : extra;
    this.resetState();
    return text ? [{ kind: 'truncated', text, reason }] : [];
  }

  private feed(text: string, now: number): StreamEvent[] {
    if (!text) return [];
    const events: StreamEvent[] = [];
    this.buf += text;

    for (let i = this.pos; i < this.buf.length; i++) {
      const ch = this.buf[i];
      if (this.start < 0) {
        if (ch === '{') {
          const junk = this.buf.slice(0, i).trim();
          if (junk) events.push({ kind: 'text', text: junk });
          this.buf = this.buf.slice(i);
          i = 0;
          this.start = 0;
          this.depth = 1;
          this.inString = false;
          this.escape = false;
          this.pendingSinceTs = now;
          this.msgChunks = this.currentChunkSize === null ? [] : [this.currentChunkSize];
        }
        continue;
      }

      if (this.inString) {
        if (this.escape) this.escape = false;
        else if (ch === '\\') this.escape = true;
        else if (ch === '"') this.inString = false;
        continue;
      }

      if (ch === '"') this.inString = true;
      else if (ch === '{' || ch === '[') this.depth++;
      else if (ch === '}' || ch === ']') {
        this.depth--;
        if (this.depth === 0) {
          const segment = this.buf.slice(this.start, i + 1);
          const chunks = this.msgChunks;
          const size = this.firmwareChunkSize;
          if (size !== null && chunks.length > 1 && chunks.slice(0, -1).some((c) => c !== size)) {
            events.push({ kind: 'truncated', text: segment, reason: 'chunk-gap', chunkSizes: [...chunks] });
          } else {
            try {
              events.push({ kind: 'json', value: JSON.parse(segment), text: segment });
            } catch (error) {
              events.push({ kind: 'invalid', text: segment, error: error instanceof Error ? error.message : String(error) });
            }
          }
          this.msgChunks = [];
          this.buf = this.buf.slice(i + 1);
          i = -1;
          this.start = -1;
          this.pendingSinceTs = null;
        }
      }
    }

    if (this.start < 0) {
      // 没有未完成的消息：buf 里只剩对象之外的文本，留着等下一个 `{`
      this.pos = this.buf.length;
      if (this.buf.length > this.maxBuffer) {
        events.push({ kind: 'text', text: this.buf.trim() });
        this.resetState();
      }
    } else {
      this.pos = this.buf.length;
      if (this.buf.length - this.start > this.maxBuffer) {
        events.push(...this.discardPending('overflow'));
      }
    }
    return events;
  }
}
