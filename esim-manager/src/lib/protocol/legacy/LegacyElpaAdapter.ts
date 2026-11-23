import { MAX_COMMAND_BYTES } from '@/lib/ble/constants';
import { CardNotInsertedError, DisconnectedError, LpacError, ResponseTimeoutError } from '../errors';
import type { IncomingMessage, MessageLink } from '../link';
import type { ElpaInfoMessage, LpaMessage, ProgressMessage, WifiInfoMessage } from '../messages';
import type { LegacyCommandSpec } from './commands';

export interface CliRequestOptions {
  onProgress?: (progress: ProgressMessage) => void;
  timeoutMs?: number;
}

export interface CliResult {
  dataType: string;
  data: unknown;
  /** 非致命的中间错误，例如 euicc_init 失败后固件仍继续执行。 */
  warnings: string[];
}

export interface AdapterEvents {
  /** 与当前请求无关的消息（主动推送或迟到的回复）。 */
  onStray?: (message: IncomingMessage, reason: string) => void;
}

/**
 * 旧版 eLPA 固件协议适配器：JSON 控制命令 + lpac CLI 文本命令。
 *
 * 固件在单个 FreeRTOS 任务里串行处理命令（ble_sim_uart_tt.cpp: recv_data_task），
 * 回复里不带请求 ID，所以本适配器同一时间只允许一个请求在途，并按以下规则匹配回复：
 *
 * - JSON 命令：等待 cmd 相同的回复（getElpaInfo / getWifiInfo）。setWifiInfo 固件不回复。
 * - CLI 命令：
 *   - progress → 进度回调；
 *   - lpa 且 code=0 且 dataType 与预期一致 → 成功；dataType 不一致视为迟到的回复，忽略；
 *   - lpa 且 code≠0：message 为 euicc_init 时不终止（main.c 中 main_init_euicc 失败后
 *     并不退出，后续步骤会再报一次错），其他在预期列表中的函数名 → 失败；
 *   - cardStatus 且 cardInserted=false → 未插卡。
 */
export class LegacyElpaAdapter {
  readonly id = 'legacy-elpa' as const;
  readonly maxCommandBytes = MAX_COMMAND_BYTES;
  private chain: Promise<unknown> = Promise.resolve();
  private current: { abort: (error: Error) => void } | null = null;
  private queued = 0;

  constructor(
    private readonly link: MessageLink,
    private readonly events: AdapterEvents = {},
  ) {}

  get busy(): boolean {
    return this.current !== null || this.queued > 0;
  }

  /** 中止在途请求（例如蓝牙断开）。 */
  abortAll(error: Error = new DisconnectedError()): void {
    this.current?.abort(error);
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    this.queued++;
    const run = () => {
      this.queued--;
      return task();
    };
    const result = this.chain.then(run, run);
    this.chain = result.catch(() => undefined);
    return result;
  }

  /** 发送 JSON 控制命令并等待对应回复。 */
  requestJson(spec: LegacyCommandSpec, text: string): Promise<ElpaInfoMessage | WifiInfoMessage> {
    const expected = spec.responseCmd === 'getElpaInfo' ? 'elpaInfo' : spec.responseCmd === 'getWifiInfo' ? 'wifiInfo' : null;
    if (!expected) throw new Error(`${spec.id} 没有回复，请使用 sendWithoutReply`);
    return this.exclusive(
      () =>
        new Promise<ElpaInfoMessage | WifiInfoMessage>((resolve, reject) => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          let done = false;
          const finish = (error: Error | null, value?: ElpaInfoMessage | WifiInfoMessage) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            unsubscribe();
            this.current = null;
            if (error) reject(error);
            else resolve(value!);
          };
          const unsubscribe = this.link.onMessage((incoming) => {
            const m = incoming.message;
            if (m.type === expected) finish(null, m as ElpaInfoMessage | WifiInfoMessage);
            else this.events.onStray?.(incoming, `等待 ${spec.id} 回复时收到`);
          });
          this.current = { abort: (e) => finish(e) };
          timer = setTimeout(() => finish(new ResponseTimeoutError(spec.label, spec.timeoutMs)), spec.timeoutMs);
          this.link.send(text, { maxBytes: this.maxCommandBytes, label: spec.label }).catch((e: Error) => finish(e));
        }),
    );
  }

  /** 发送固件不会回复的命令（setWifiInfo）。 */
  sendWithoutReply(spec: LegacyCommandSpec, text: string): Promise<void> {
    return this.exclusive(() => this.link.send(text, { maxBytes: this.maxCommandBytes, label: spec.label }));
  }

  /** 发送 lpac CLI 命令并等待终止消息。 */
  requestCli(spec: LegacyCommandSpec, text: string, options: CliRequestOptions = {}): Promise<CliResult> {
    const timeoutMs = options.timeoutMs ?? spec.timeoutMs;
    return this.exclusive(
      () =>
        new Promise<CliResult>((resolve, reject) => {
          const warnings: string[] = [];
          let timer: ReturnType<typeof setTimeout> | undefined;
          let done = false;
          const arm = () => {
            clearTimeout(timer);
            timer = setTimeout(() => finish(new ResponseTimeoutError(spec.label, timeoutMs)), timeoutMs);
          };
          const finish = (error: Error | null, value?: CliResult) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            unsubscribe();
            this.current = null;
            if (error) reject(error);
            else resolve(value!);
          };
          const handleLpa = (incoming: IncomingMessage, m: LpaMessage) => {
            if (m.code === 0) {
              if (m.dataType === spec.successDataType) finish(null, { dataType: m.dataType, data: m.data, warnings });
              else this.events.onStray?.(incoming, `等待 ${spec.successDataType} 时收到 dataType=${m.dataType}`);
              return;
            }
            if (m.message === 'euicc_init') {
              warnings.push('euicc_init 失败（固件会继续执行后续步骤）');
              return;
            }
            const expected = spec.errorMessages ?? [];
            if (expected.length === 0 || expected.includes(m.message)) {
              finish(new LpacError(m.message, typeof m.data === 'string' ? m.data : '', spec.id));
            } else {
              this.events.onStray?.(incoming, `等待 ${spec.id} 时收到不相关的错误 ${m.message}`);
            }
          };
          const unsubscribe = this.link.onMessage((incoming) => {
            const m = incoming.message;
            switch (m.type) {
              case 'progress':
                options.onProgress?.(m);
                if (spec.progressResetsTimeout) arm();
                break;
              case 'lpa':
                handleLpa(incoming, m);
                break;
              case 'cardStatus':
                if (!m.cardInserted) finish(new CardNotInsertedError());
                break;
              default:
                this.events.onStray?.(incoming, `等待 ${spec.id} 时收到`);
            }
          });
          this.current = { abort: (e) => finish(e) };
          arm();
          this.link.send(text, { maxBytes: this.maxCommandBytes, label: spec.label }).catch((e: Error) => finish(e));
        }),
    );
  }
}
