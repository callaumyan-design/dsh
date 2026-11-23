/**
 * 读卡器 USB 串口日志（Web Serial）。
 *
 * 官方 eLPA 固件（V2.1.0 / V2.2.1 发布版都启用了 ENABLE_DEBUG_LOGS）在 115200 波特率下
 * 输出调试日志，其中包括每条 APDU（iso7816 驱动的 `TX[..]` / `RX[..]`）、
 * T=0 过程字节（`TPDU-C` / `TPDU-R`）、传输错误（`Failed to receive data!`）以及 HTTP 请求。
 * 这是排查“写入 eUICC 失败”这类问题唯一能看到卡片真实状态字的途径。
 *
 * 日志里有大量敏感信息（Wi-Fi 密码、激活码参数、EID、Profile 包），所以每一行在进入内存前
 * 都会脱敏：十六进制 APDU 只保留前 8 字节（指令头）和最后 2 字节（状态字）。
 */
import { HIDDEN, redactText } from '@/lib/protocol/redact';

export type SerialLineKind = 'apdu-tx' | 'apdu-rx' | 'error' | 'http' | 'info';

export interface SerialLine {
  id: number;
  ts: number;
  kind: SerialLineKind;
  text: string;
  /** RX 行的状态字（十六进制，大写）。 */
  sw?: string;
  /** 状态字是否异常（不是 9000 / 61xx / 91xx）。 */
  abnormal?: boolean;
}

export interface SerialSnapshot {
  supported: boolean;
  state: 'idle' | 'connecting' | 'connected' | 'error';
  portLabel: string | null;
  error: string | null;
  lines: readonly SerialLine[];
  abnormalCount: number;
  transportFailures: number;
  lastAbnormal: SerialLine | null;
}

/** 常见状态字说明（ISO 7816-4 / GlobalPlatform / 本固件的约定）。 */
export const SW_MEANINGS: Record<string, string> = {
  '6900': '读卡器与卡片之间传输失败（固件在 APDU 收发出错时伪造的状态字）',
  '6581': '存储器故障',
  '6700': '长度错误',
  '6882': '不支持安全消息',
  '6982': '安全状态不满足',
  '6985': '使用条件不满足',
  '6A80': '数据字段错误（卡片不接受这段数据）',
  '6A82': '文件或应用未找到',
  '6A84': '卡片存储空间不足',
  '6A86': 'P1/P2 参数错误',
  '6A88': '引用的数据未找到',
  '6D00': '指令不支持',
  '6E00': 'CLA 不支持',
  '6F00': '卡片内部未知错误',
};

export function describeSw(sw: string): string {
  const up = sw.toUpperCase();
  if (up === '9000') return '成功';
  if (up.startsWith('61')) return `还有 ${parseInt(up.slice(2), 16) || 256} 字节待读取`;
  if (up.startsWith('6C')) return `Le 错误，应为 ${parseInt(up.slice(2), 16)}`;
  return SW_MEANINGS[up] ?? '非成功状态字';
}

const ANSI = /\x1b\[[0-9;]*m/g;
const APDU_LINE = /\b(TX|RX)\[\s*(\d+)\]\s*:?\s*([0-9A-F]+)\s*$/i;

/** 十六进制长串只保留前 8 字节和最后 2 字节。 */
function redactHex(text: string): string {
  return text.replace(/\b[0-9A-F]{24,}\b/gi, (m) => `${m.slice(0, 16)}…[${m.length / 2 - 10} 字节已隐藏]…${m.slice(-4)}`);
}

function redactBase64(text: string): string {
  return text.replace(/[A-Za-z0-9+/]{48,}={0,2}/g, (m) => `‹base64 ${m.length} 字符›`);
}

/** 逐行脱敏器（有状态：`argv[n]: -m` 之后的下一个参数要隐藏）。 */
export class SerialRedactor {
  private hideNextArgv = false;

  line(raw: string): string {
    let text = raw.replace(ANSI, '').replace(/\r/g, '');
    const argv = text.match(/argv\[\d+\]:\s*(.*)$/);
    if (argv) {
      const value = argv[1] ?? '';
      if (this.hideNextArgv) {
        text = text.replace(/(argv\[\d+\]:\s*).*$/, `$1${HIDDEN}`);
        this.hideNextArgv = false;
      } else {
        this.hideNextArgv = /^-(m|c|a|i)$/.test(value.trim());
      }
    }
    text = text.replace(/(Password:\s*)\S.*$/i, `$1${HIDDEN}`);
    text = text.replace(/(\s-(?:m|c|a|i)\s+)\S+/g, `$1${HIDDEN}`);
    text = redactHex(text);
    text = redactBase64(text);
    return redactText(text);
  }
}

export function classifySerialLine(raw: string): Pick<SerialLine, 'kind' | 'sw' | 'abnormal'> {
  const text = raw.replace(ANSI, '');
  const apdu = text.match(APDU_LINE);
  if (apdu) {
    const dir = (apdu[1] ?? '').toUpperCase();
    const hex = apdu[3] ?? '';
    if (dir === 'RX' && hex.length >= 4) {
      const sw = hex.slice(-4).toUpperCase();
      const abnormal = !(sw === '9000' || sw.startsWith('61') || sw.startsWith('91'));
      return { kind: 'apdu-rx', sw, abnormal };
    }
    return { kind: dir === 'RX' ? 'apdu-rx' : 'apdu-tx' };
  }
  if (/TPDU-[CR]/.test(text)) return { kind: /TPDU-R/.test(text) ? 'apdu-rx' : 'apdu-tx' };
  if (/Failed|failed|Invalid|error|Error|ERR/.test(text)) return { kind: 'error' };
  if (/HTTP|Response\[|https?:\/\//.test(text)) return { kind: 'http' };
  return { kind: 'info' };
}

// ---------------------------------------------------------------------------
// Web Serial（最小类型声明，避免额外依赖）
// ---------------------------------------------------------------------------

interface SerialPortInfoLike {
  usbVendorId?: number;
  usbProductId?: number;
}
export interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  getInfo?(): SerialPortInfoLike;
  setSignals?(signals: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void>;
}
export interface SerialLike {
  requestPort(options?: { filters?: SerialPortInfoLike[] }): Promise<SerialPortLike>;
  addEventListener?(type: 'disconnect', listener: (e: Event) => void): void;
}

const VENDORS: Record<number, string> = { 0x1a86: 'CH340 / CH343（WCH）', 0x303a: 'ESP32-S3 USB', 0x10c4: 'CP210x（Silicon Labs）', 0x0403: 'FTDI' };
const MAX_LINES = 5000;

export class SerialLogController {
  private snapshot: SerialSnapshot;
  private listeners = new Set<() => void>();
  private port: SerialPortLike | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private redactor = new SerialRedactor();
  private partial = '';
  private seq = 0;
  private lines: SerialLine[] = [];

  constructor(private readonly serial: SerialLike | undefined = typeof navigator !== 'undefined' ? (navigator as unknown as { serial?: SerialLike }).serial : undefined) {
    this.snapshot = { supported: !!serial, state: 'idle', portLabel: null, error: null, lines: [], abnormalCount: 0, transportFailures: 0, lastAbnormal: null };
  }

  getSnapshot = () => this.snapshot;
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private set(patch: Partial<SerialSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l();
  }

  /** 必须在用户点击中调用。allPorts=true 时不按 USB 厂商过滤。 */
  async connect(allPorts = false): Promise<void> {
    if (!this.serial) throw new Error('此浏览器不支持 Web Serial（需要桌面版 Chrome / Edge）。');
    if (this.port) await this.disconnect();
    this.set({ state: 'connecting', error: null });
    try {
      const port = await this.serial.requestPort(allPorts ? {} : { filters: Object.keys(VENDORS).map((v) => ({ usbVendorId: Number(v) })) });
      await port.open({ baudRate: 115200 });
      // 释放 DTR/RTS，尽量避免触发 ESP32 的自动复位电路
      await port.setSignals?.({ dataTerminalReady: false, requestToSend: false }).catch(() => undefined);
      this.port = port;
      const info = port.getInfo?.() ?? {};
      this.set({ state: 'connected', portLabel: info.usbVendorId !== undefined ? (VENDORS[info.usbVendorId] ?? `USB ${info.usbVendorId.toString(16)}`) : '串口' });
      this.serial.addEventListener?.('disconnect', this.onDisconnect);
      void this.readLoop(port);
    } catch (error) {
      const name = (error as { name?: string } | null)?.name;
      if (name === 'NotFoundError') {
        this.set({ state: 'idle' });
        return;
      }
      const message =
        name === 'InvalidStateError' || name === 'NetworkError'
          ? '串口打不开：可能被 Arduino 串口监视器、Flash Download Tool 等其他程序占用。'
          : error instanceof Error
            ? error.message
            : String(error);
      this.set({ state: 'error', error: message });
      throw new Error(message);
    }
  }

  private onDisconnect = () => {
    void this.disconnect('串口设备已拔出。');
  };

  private async readLoop(port: SerialPortLike) {
    const decoder = new TextDecoder();
    while (port.readable && this.port === port) {
      const reader = port.readable.getReader();
      this.reader = reader;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) this.ingest(decoder.decode(value, { stream: true }));
        }
      } catch {
        // 帧错误等可恢复错误：重新获取 reader
      } finally {
        reader.releaseLock();
      }
      if (this.port !== port) break;
    }
  }

  /** 处理一段原始文本（测试与 readLoop 共用）。 */
  ingest(text: string) {
    const parts = (this.partial + text).split('\n');
    this.partial = parts.pop() ?? '';
    if (this.partial.length > 8192) {
      parts.push(this.partial);
      this.partial = '';
    }
    let changed = false;
    for (const raw of parts) {
      if (!raw.trim()) continue;
      const cls = classifySerialLine(raw);
      const line: SerialLine = { id: ++this.seq, ts: Date.now(), text: this.redactor.line(raw), ...cls };
      this.lines.push(line);
      changed = true;
    }
    if (!changed) return;
    if (this.lines.length > MAX_LINES) this.lines.splice(0, this.lines.length - MAX_LINES);
    const abnormal = this.lines.filter((l) => l.abnormal);
    this.set({
      lines: [...this.lines],
      abnormalCount: abnormal.length,
      lastAbnormal: abnormal.at(-1) ?? null,
      transportFailures: this.lines.filter((l) => /Failed to receive data|Failed to exchange APDU/.test(l.text)).length,
    });
  }

  async disconnect(reason?: string): Promise<void> {
    const port = this.port;
    this.port = null;
    try {
      await this.reader?.cancel();
    } catch {
      /* 忽略 */
    }
    try {
      await port?.close();
    } catch {
      /* 忽略 */
    }
    this.reader = null;
    this.set({ state: reason ? 'error' : 'idle', error: reason ?? null });
  }

  clear() {
    this.lines = [];
    this.partial = '';
    this.set({ lines: [], abnormalCount: 0, transportFailures: 0, lastAbnormal: null });
  }

  exportText(header: Record<string, string>): string {
    const head = Object.entries(header)
      .map(([k, v]) => `# ${k}: ${redactText(v)}`)
      .join('\n');
    return `${head}\n\n${this.lines.map((l) => `${new Date(l.ts).toISOString()} ${l.text}${l.sw ? `    [SW ${l.sw} ${describeSw(l.sw)}]` : ''}`).join('\n')}\n`;
  }
}

let singleton: SerialLogController | null = null;
export function serialLog(): SerialLogController {
  if (!singleton) singleton = new SerialLogController();
  return singleton;
}
