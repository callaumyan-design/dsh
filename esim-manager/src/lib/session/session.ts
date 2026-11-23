import { FIRMWARE_TX_CHUNK_SIZE } from '@/lib/ble/constants';
import { BleTransport, type RequestMode, type TransportInfo, TransportError } from '@/lib/ble/transport';
import { type BluetoothSupport, detectBluetoothSupport, detectBluetoothSupportSync } from '@/lib/ble/support';
import { ApduEuiccService, type DownloadRequest, type EuiccService, LegacyEuiccService } from '@/lib/euicc/service';
import type { ChipInfo, DownloadProgress, ElpaInfo, EuiccNotification, EuiccProfile, WifiInfo } from '@/lib/euicc/types';
import { parseElpaInfo, parseWifiInfo } from '@/lib/euicc/parse';
import { Logger } from '@/lib/log/logger';
import { ApduJsonAdapter } from '@/lib/protocol/apdu/ApduJsonAdapter';
import { CardNotInsertedError, DisconnectedError, LpacError, ResponseTimeoutError, UnsupportedOperationError } from '@/lib/protocol/errors';
import { CommandValidationError, encodeCommand, LEGACY_COMMANDS, commandBuilders } from '@/lib/protocol/legacy/commands';
import { LegacyElpaAdapter } from '@/lib/protocol/legacy/LegacyElpaAdapter';
import type { IncomingMessage, MessageLink, SendOptions } from '@/lib/protocol/link';
import { classifyMessage, describeMessage, type UpgradeMessage } from '@/lib/protocol/messages';
import { redactCommand, redactJsonForLog, redactText } from '@/lib/protocol/redact';
import { JsonMessageStream, type StreamEvent } from '@/lib/protocol/stream';
import { errorMessage, sleep } from '@/lib/utils';
import { classifyConsoleCommand, type ReadOnlyCommandId } from './consoleCommands';

export type ProtocolMode = 'auto' | 'legacy-elpa' | 'apdu-json';
export type ProtocolId = 'legacy-elpa' | 'apdu-json';
export type ProtocolStatus = 'none' | 'probing' | 'identified' | 'unidentified' | 'manual';

export interface OperationState {
  id: number;
  key: string;
  label: string;
  write: boolean;
  startedAt: number;
  progress: DownloadProgress | null;
}

export interface TrackedError {
  id: number;
  at: number;
  context: string;
  message: string;
  name: string;
}

export interface StreamStats {
  notifications: number;
  bytes: number;
  minChunk: number | null;
  maxChunk: number | null;
  recentChunks: number[];
  messages: number;
  invalid: number;
  truncated: number;
  strays: number;
  timeouts: number;
  writes: number;
  writeBytes: number;
  maxWrite: number;
}

export interface SessionSettings {
  /** 连接成功后自动发送只读的 getElpaInfo 识别协议。 */
  autoIdentify: boolean;
  /** 识别为旧版协议后自动读取芯片信息和 Profile 列表（只读）。 */
  autoReadCard: boolean;
}

export interface SessionState {
  support: BluetoothSupport;
  transport: TransportInfo;
  protocol: { mode: ProtocolMode; active: ProtocolId | null; status: ProtocolStatus; detail: string | null };
  device: { info: ElpaInfo | null; wifi: WifiInfo | null; lpacVersion: string | null; upgrade: UpgradeMessage | null; updatedAt: number | null };
  card: {
    inserted: boolean | null;
    chip: ChipInfo | null;
    profiles: EuiccProfile[] | null;
    notifications: EuiccNotification[] | null;
    discovery: string[] | null;
    updatedAt: number | null;
  };
  operation: OperationState | null;
  /** 写操作进行中蓝牙断开：结果未知，提示用户核对，绝不自动重试。 */
  interrupted: { label: string; at: number } | null;
  /** 最近一次下载的结果与事后核对（只读读取的 Profile / 通知）。 */
  lastDownload: DownloadReport | null;
  errors: TrackedError[];
  stats: StreamStats;
  settings: SessionSettings;
}

export interface DownloadReport {
  at: number;
  ok: boolean;
  /** 失败时固件报告的函数名。 */
  failedStage: string | null;
  /** 失败细节（已脱敏的错误信息）。 */
  error: string | null;
  /** 下载前卡上已有的 ICCID（在内存中，不记录日志）。 */
  iccidsBefore: string[] | null;
  /** 事后重新读取到、下载前不存在的 Profile。 */
  newProfiles: EuiccProfile[];
  /** 事后读取的通知列表；null 表示未能读取。 */
  notificationsAfter: EuiccNotification[] | null;
}

export class BusyError extends Error {
  constructor(current: string) {
    super(`正在执行「${current}」，请等待完成后再操作。`);
    this.name = 'BusyError';
  }
}

export class NotReadyError extends Error {
  constructor(message = '尚未连接设备或尚未确定通信协议。') {
    super(message);
    this.name = 'NotReadyError';
  }
}

const emptyStats = (): StreamStats => ({
  notifications: 0,
  bytes: 0,
  minChunk: null,
  maxChunk: null,
  recentChunks: [],
  messages: 0,
  invalid: 0,
  truncated: 0,
  strays: 0,
  timeouts: 0,
  writes: 0,
  writeBytes: 0,
  maxWrite: 0,
});

const emptyDevice = (): SessionState['device'] => ({ info: null, wifi: null, lpacVersion: null, upgrade: null, updatedAt: null });
const emptyCard = (): SessionState['card'] => ({ inserted: null, chip: null, profiles: null, notifications: null, discovery: null, updatedAt: null });

const TRUNCATE_REASON = {
  resync: '新消息已开始而上一条未闭合',
  flush: '超时无后续数据',
  overflow: '超过缓冲上限',
  'chunk-gap': '中间分片不足 256 字节，数据在传输中被截断',
} as const;

/** 未完成的消息在多长时间没有新数据后被视为截断。 */
const STALE_PENDING_MS = 4000;

export interface SessionDeps {
  transport?: BleTransport;
  logger?: Logger;
  support?: BluetoothSupport;
}

/**
 * 应用会话：把传输层、流解析、协议适配器和业务服务串起来，并维护 UI 状态。
 *
 * 安全约束：
 * - 构造与页面加载时不发送任何数据；只有用户点击“连接”后才可能自动发送只读命令；
 * - 同一时间只允许一个操作；
 * - 断开时中止在途操作，写操作标记为“结果未知”，不自动恢复；
 * - 不在 localStorage 保存任何设备数据。
 */
export class SessionController {
  readonly logger: Logger;
  readonly transport: BleTransport;
  private stream = new JsonMessageStream({ firmwareChunkSize: FIRMWARE_TX_CHUNK_SIZE });
  private messageListeners = new Set<(m: IncomingMessage) => void>();
  private stateListeners = new Set<() => void>();
  private state: SessionState;
  private service: EuiccService | null = null;
  private opSeq = 0;
  private errSeq = 0;
  private lastDataAt = 0;
  private staleTimer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: SessionDeps = {}) {
    this.logger = deps.logger ?? new Logger();
    this.transport = deps.transport ?? new BleTransport();
    this.state = {
      support: deps.support ?? detectBluetoothSupportSync(),
      transport: this.transport.info,
      protocol: { mode: 'auto', active: null, status: 'none', detail: null },
      device: emptyDevice(),
      card: emptyCard(),
      operation: null,
      interrupted: null,
      lastDownload: null,
      errors: [],
      stats: emptyStats(),
      settings: { autoIdentify: true, autoReadCard: true },
    };
    this.transport.events.on('state', (info) => this.onTransportState(info));
    this.transport.events.on('data', (chunk) => this.onData(chunk));
    this.transport.events.on('log', ({ level, message }) => this.logger.log(level, 'ble', message));
  }

  // ------------------------------------------------------------------ store

  getSnapshot = (): SessionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  };

  private update(fn: (s: SessionState) => SessionState) {
    this.state = fn(this.state);
    for (const l of this.stateListeners) l();
  }

  // ------------------------------------------------------------------ link

  private readonly link: MessageLink = {
    send: async (text: string, options: SendOptions) => {
      const bytes = encodeCommand(text, options.maxBytes);
      this.logger.info('tx', `→ ${options.label}（${bytes.length} 字节）`, redactCommand(text));
      await this.transport.write(bytes, options.maxBytes);
      this.update((s) => ({
        ...s,
        stats: { ...s.stats, writes: s.stats.writes + 1, writeBytes: s.stats.writeBytes + bytes.length, maxWrite: Math.max(s.stats.maxWrite, bytes.length) },
      }));
    },
    onMessage: (listener) => {
      this.messageListeners.add(listener);
      return () => this.messageListeners.delete(listener);
    },
    isConnected: () => this.transport.connected,
  };

  // ------------------------------------------------------------- incoming

  private onData(chunk: Uint8Array) {
    this.lastDataAt = Date.now();
    this.update((s) => {
      const st = s.stats;
      return {
        ...s,
        stats: {
          ...st,
          notifications: st.notifications + 1,
          bytes: st.bytes + chunk.length,
          minChunk: st.minChunk === null ? chunk.length : Math.min(st.minChunk, chunk.length),
          maxChunk: st.maxChunk === null ? chunk.length : Math.max(st.maxChunk, chunk.length),
          recentChunks: [...st.recentChunks.slice(-39), chunk.length],
        },
      };
    });
    // 只记录分片长度，不记录分片内容：密码等字段可能跨分片，无法逐片脱敏。
    this.logger.debug('rx', `通知分片 ${chunk.length} 字节`);
    for (const event of this.stream.push(chunk)) this.onStreamEvent(event);
  }

  private onStreamEvent(event: StreamEvent) {
    switch (event.kind) {
      case 'json': {
        const message = classifyMessage(event.value);
        this.update((s) => ({ ...s, stats: { ...s.stats, messages: s.stats.messages + 1 } }));
        this.logger.info('rx', `← ${describeMessage(message)}`, redactJsonForLog(event.value));
        this.applyUnsolicited(message);
        const incoming: IncomingMessage = { message, text: event.text, at: Date.now() };
        for (const l of [...this.messageListeners]) l(incoming);
        break;
      }
      case 'invalid':
        this.update((s) => ({ ...s, stats: { ...s.stats, invalid: s.stats.invalid + 1 } }));
        this.logger.warn('rx', `收到无法解析的 JSON（${event.error}）`, redactText(event.text.slice(0, 600)));
        break;
      case 'truncated':
        this.update((s) => ({ ...s, stats: { ...s.stats, truncated: s.stats.truncated + 1 } }));
        this.logger.warn(
          'rx',
          `丢弃了一条不完整的消息（${event.text.length} 字符，原因：${TRUNCATE_REASON[event.reason]}${event.chunkSizes ? `，分片 ${event.chunkSizes.join('+')} 字节` : ''}）。若频繁出现，可能是 BLE MTU 过小导致通知被截断，请查看诊断页的分片统计。`,
          redactText(event.text.slice(0, 600)),
        );
        break;
      case 'text':
        this.logger.warn('rx', '收到 JSON 之外的文本', redactText(event.text.slice(0, 300)));
        break;
    }
  }

  /** 设备主动推送或任何时候都可安全应用的状态。 */
  private applyUnsolicited(message: ReturnType<typeof classifyMessage>) {
    const now = Date.now();
    switch (message.type) {
      case 'cardStatus':
        this.update((s) => ({
          ...s,
          card: message.cardInserted ? { ...s.card, inserted: true } : { ...emptyCard(), inserted: false, updatedAt: now },
        }));
        break;
      case 'elpaInfo': {
        const info = parseElpaInfo(message.data);
        this.update((s) => ({ ...s, device: { ...s.device, info, wifi: info.wifi, updatedAt: now } }));
        break;
      }
      case 'wifiInfo': {
        const wifi = parseWifiInfo(message.data);
        this.update((s) => ({ ...s, device: { ...s.device, wifi, updatedAt: now } }));
        break;
      }
      case 'upgrade':
        this.update((s) => ({ ...s, device: { ...s.device, upgrade: message } }));
        break;
      default:
        break;
    }
  }

  private onStray = (incoming: IncomingMessage, reason: string) => {
    this.update((s) => ({ ...s, stats: { ...s.stats, strays: s.stats.strays + 1 } }));
    this.logger.debug('protocol', `未匹配到在途请求的消息：${reason} ${describeMessage(incoming.message)}`);
  };

  private checkStale = () => {
    if (this.stream.hasPending && Date.now() - this.lastDataAt > STALE_PENDING_MS) {
      for (const event of this.stream.flush()) this.onStreamEvent(event);
    }
  };

  // ------------------------------------------------------------- transport

  private onTransportState(info: TransportInfo) {
    const prev = this.state.transport.state;
    this.update((s) => ({ ...s, transport: info }));
    if (info.state === 'connected' && prev !== 'connected') {
      this.stream.reset();
      if (!this.staleTimer) this.staleTimer = setInterval(this.checkStale, 1000);
    }
    if ((info.state === 'disconnected' || info.state === 'idle') && prev !== info.state) {
      this.handleDisconnect(info);
    }
  }

  private handleDisconnect(info: TransportInfo) {
    if (this.staleTimer) {
      clearInterval(this.staleTimer);
      this.staleTimer = null;
    }
    const op = this.state.operation;
    this.service?.abortAll(new DisconnectedError(info.userInitiatedDisconnect ? '已主动断开蓝牙' : '蓝牙连接意外断开'));
    this.service = null;
    this.stream.reset();
    this.update((s) => ({
      ...s,
      protocol: { ...s.protocol, active: null, status: 'none', detail: null },
      device: emptyDevice(),
      card: emptyCard(),
      operation: null,
      lastDownload: null,
      interrupted: op && op.write ? { label: op.label, at: Date.now() } : s.interrupted,
    }));
    if (op?.write) this.logger.error('app', `写操作「${op.label}」进行中蓝牙断开，结果未知。不会自动重试，请重新连接后刷新核对。`);
  }

  // --------------------------------------------------------------- helpers

  private trackError(context: string, error: unknown) {
    const message = redactText(errorMessage(error));
    const name = error instanceof Error ? error.name : 'Error';
    if (error instanceof ResponseTimeoutError) this.update((s) => ({ ...s, stats: { ...s.stats, timeouts: s.stats.timeouts + 1 } }));
    this.update((s) => ({ ...s, errors: [...s.errors.slice(-49), { id: ++this.errSeq, at: Date.now(), context, message, name }] }));
    this.logger.error('app', `${context}失败：${message}`);
  }

  private requireService(): EuiccService {
    if (!this.transport.connected) throw new NotReadyError('蓝牙未连接。');
    if (!this.service) throw new NotReadyError('尚未确定通信协议，请先在诊断页识别或手动选择协议。');
    return this.service;
  }

  private async run<T>(key: string, label: string, write: boolean, task: (svc: EuiccService, setProgress: (p: DownloadProgress) => void) => Promise<T>, options: { requireService?: boolean } = {}): Promise<T> {
    const current = this.state.operation;
    if (current) throw new BusyError(current.label);
    const svc = options.requireService === false ? (this.service as EuiccService) : this.requireService();
    const op: OperationState = { id: ++this.opSeq, key, label, write, startedAt: Date.now(), progress: null };
    this.update((s) => ({ ...s, operation: op, interrupted: write ? null : s.interrupted }));
    this.logger.info('app', `开始：${label}${write ? '（写操作）' : ''}`);
    const setProgress = (progress: DownloadProgress) => {
      if (this.state.operation?.id !== op.id) return;
      this.update((s) => ({ ...s, operation: s.operation ? { ...s.operation, progress } : null }));
    };
    try {
      const result = await task(svc, setProgress);
      this.logger.info('app', `完成：${label}（${Date.now() - op.startedAt} ms）`);
      return result;
    } catch (error) {
      this.trackError(label, error);
      throw error;
    } finally {
      if (this.state.operation?.id === op.id) this.update((s) => ({ ...s, operation: null }));
    }
  }

  // ------------------------------------------------------------ connection

  async refreshSupport(): Promise<void> {
    const support = await detectBluetoothSupport();
    this.update((s) => ({ ...s, support }));
    this.logger.info('env', `Web Bluetooth：API ${support.apiPresent ? '存在' : '不存在'}，安全上下文 ${support.secureContext ? '是' : '否'}，适配器 ${support.availability}`);
  }

  setSettings(patch: Partial<SessionSettings>) {
    this.update((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  }

  /** 由用户点击触发：打开设备选择器并连接。 */
  async connect(mode: RequestMode = 'filtered'): Promise<void> {
    try {
      await this.transport.requestAndConnect(mode);
    } catch (error) {
      if (error instanceof TransportError && error.code === 'cancelled') return;
      this.trackError('连接', error);
      throw error;
    }
    await this.afterConnect();
  }

  /** 重新连接已授权的设备（不需要再次选择）。 */
  async reconnect(): Promise<void> {
    try {
      await this.transport.connect();
    } catch (error) {
      this.trackError('重新连接', error);
      throw error;
    }
    await this.afterConnect();
  }

  async disconnect(): Promise<void> {
    await this.transport.disconnect();
  }

  async forgetDevice(): Promise<void> {
    await this.transport.forget();
  }

  dismissInterrupted() {
    this.update((s) => ({ ...s, interrupted: null }));
  }

  clearErrors() {
    this.update((s) => ({ ...s, errors: [] }));
  }

  resetStats() {
    this.update((s) => ({ ...s, stats: emptyStats() }));
  }

  private async afterConnect() {
    if (this.state.protocol.mode !== 'auto') {
      this.activate(this.state.protocol.mode, 'manual', '手动选择的协议');
      if (this.state.protocol.mode === 'legacy-elpa' && this.state.settings.autoIdentify) await this.refreshDevice().catch(() => undefined);
      if (this.state.settings.autoReadCard) await this.safeAutoRead();
      return;
    }
    if (!this.state.settings.autoIdentify) {
      this.update((s) => ({ ...s, protocol: { ...s.protocol, status: 'none', detail: '已关闭自动识别，请在诊断页手动识别。' } }));
      return;
    }
    const ok = await this.identify().catch(() => false);
    if (ok && this.state.settings.autoReadCard) await this.safeAutoRead();
  }

  private async safeAutoRead() {
    try {
      await this.refreshCard();
    } catch {
      /* 错误已记录 */
    }
  }

  private activate(protocol: ProtocolId, status: ProtocolStatus, detail: string) {
    this.service?.abortAll(new Error('协议已切换'));
    this.service =
      protocol === 'legacy-elpa'
        ? new LegacyEuiccService(new LegacyElpaAdapter(this.link, { onStray: this.onStray }))
        : new ApduEuiccService(new ApduJsonAdapter(this.link));
    // 只有旧版 eLPA 固件的分段规律（每段 256 字节）有源码依据
    this.stream.setFirmwareChunkSize(protocol === 'legacy-elpa' ? FIRMWARE_TX_CHUNK_SIZE : null);
    this.update((s) => ({ ...s, protocol: { ...s.protocol, active: protocol, status, detail } }));
    this.logger.info('protocol', `使用协议：${protocol === 'legacy-elpa' ? '旧版 eLPA（JSON 控制命令 + lpac CLI）' : 'APDU JSON（NekokoLPA 风格，待设备验证）'}（${detail}）`);
  }

  /** 设置协议模式。auto 会在下次识别时生效；手动模式立即切换（若已连接）。 */
  setProtocolMode(mode: ProtocolMode) {
    if (this.state.operation) throw new BusyError(this.state.operation.label);
    this.update((s) => ({ ...s, protocol: { ...s.protocol, mode } }));
    if (mode !== 'auto' && this.transport.connected) this.activate(mode, 'manual', '手动选择的协议');
    if (mode === 'auto' && this.transport.connected) {
      this.service = null;
      this.update((s) => ({ ...s, protocol: { ...s.protocol, active: null, status: 'none', detail: '已切换为自动识别，请点击“识别协议”。' } }));
    }
  }

  /**
   * 安全的协议识别：只发送官方源码中确认为只读的 {"cmd":"getElpaInfo"}。
   * 不会自动发送 APDU 等未经验证的命令。
   */
  async identify(): Promise<boolean> {
    if (!this.transport.connected) throw new NotReadyError('蓝牙未连接。');
    if (this.state.operation) throw new BusyError(this.state.operation.label);
    this.update((s) => ({ ...s, protocol: { ...s.protocol, status: 'probing', detail: '发送只读命令 {"cmd":"getElpaInfo"}…' } }));
    const legacy = new LegacyEuiccService(new LegacyElpaAdapter(this.link, { onStray: this.onStray }));
    this.service = legacy;
    try {
      const info = await this.run('identify', '识别协议（getElpaInfo）', false, () => legacy.getDeviceInfo());
      this.activate('legacy-elpa', 'identified', `设备回复了 getElpaInfo（软件版本 ${info.software ?? '未知'}）`);
      this.update((s) => ({ ...s, device: { ...s.device, info, wifi: info.wifi, updatedAt: Date.now() } }));
      return true;
    } catch (error) {
      this.service = null;
      const detail =
        error instanceof ResponseTimeoutError
          ? '设备没有回复 getElpaInfo，无法确认为官方旧版 eLPA 固件。若确定设备运行的是 APDU JSON 固件，可在诊断页手动探测或选择协议。'
          : `识别失败：${errorMessage(error)}`;
      this.update((s) => ({ ...s, protocol: { ...s.protocol, active: null, status: 'unidentified', detail } }));
      return false;
    }
  }

  /**
   * 手动 APDU JSON 协议探测（诊断页，需用户确认）：发送 {"cmd":"APDU","action":2}。
   * 官方旧固件不认识该 cmd，会静默忽略（message_handler.cpp 中无匹配处理函数）。
   */
  async probeApduProtocol(): Promise<boolean> {
    if (!this.transport.connected) throw new NotReadyError('蓝牙未连接。');
    const adapter = new ApduJsonAdapter(this.link);
    const ok = await this.run('probe-apdu', '探测 APDU JSON 协议', false, () => adapter.probe(), { requireService: false });
    if (ok) this.activate('apdu-json', 'identified', '设备回复了 APDU JSON 探测');
    else this.logger.info('protocol', 'APDU JSON 探测无回复：设备不支持该协议。');
    return ok;
  }

  // ----------------------------------------------------------- read ops

  async refreshDevice(): Promise<void> {
    await this.run('device.info', '读取读卡器信息', false, async (svc) => {
      const info = await svc.getDeviceInfo();
      this.update((s) => ({ ...s, device: { ...s.device, info, wifi: info.wifi, updatedAt: Date.now() } }));
    });
  }

  async refreshWifi(): Promise<WifiInfo> {
    return this.run('device.wifi', '读取 Wi-Fi 状态', false, async (svc) => {
      const wifi = await svc.getWifiInfo();
      this.update((s) => ({ ...s, device: { ...s.device, wifi, updatedAt: Date.now() } }));
      return wifi;
    });
  }

  async readLpacVersion(): Promise<string> {
    return this.run('lpac.version', '读取 lpac 版本', false, async (svc) => {
      const v = await svc.getLpacVersion();
      this.update((s) => ({ ...s, device: { ...s.device, lpacVersion: v } }));
      return v;
    });
  }

  private onCardError(error: unknown) {
    if (error instanceof CardNotInsertedError) this.update((s) => ({ ...s, card: { ...emptyCard(), inserted: false, updatedAt: Date.now() } }));
  }

  async readChipInfo(): Promise<ChipInfo> {
    return this.run('chip.info', '读取芯片信息', false, async (svc) => {
      try {
        const chip = await svc.getChipInfo();
        this.update((s) => ({ ...s, card: { ...s.card, inserted: true, chip, updatedAt: Date.now() } }));
        return chip;
      } catch (error) {
        this.onCardError(error);
        throw error;
      }
    });
  }

  async readProfiles(): Promise<EuiccProfile[]> {
    return this.run('profile.list', '读取 Profile 列表', false, async (svc) => {
      try {
        const profiles = await svc.listProfiles();
        this.update((s) => ({ ...s, card: { ...s.card, inserted: true, profiles, updatedAt: Date.now() } }));
        return profiles;
      } catch (error) {
        this.onCardError(error);
        throw error;
      }
    });
  }

  /** 读取芯片信息 + Profile 列表。 */
  async refreshCard(): Promise<void> {
    await this.readChipInfo();
    if (this.state.card.inserted === false) return;
    await this.readProfiles();
  }

  async readNotifications(): Promise<EuiccNotification[]> {
    return this.run('notification.list', '读取通知列表', false, async (svc) => {
      try {
        const notifications = await svc.listNotifications();
        this.update((s) => ({ ...s, card: { ...s.card, inserted: true, notifications } }));
        return notifications;
      } catch (error) {
        this.onCardError(error);
        throw error;
      }
    });
  }

  async discoverProfiles(): Promise<string[]> {
    return this.run('profile.discovery', 'SM-DS 发现', false, async (svc, setProgress) => {
      const list = await svc.discoverProfiles({ onProgress: setProgress });
      this.update((s) => ({ ...s, card: { ...s.card, discovery: list } }));
      return list;
    });
  }

  // ---------------------------------------------------------- write ops

  /** 写操作后刷新列表，确保界面显示的是卡上的真实状态（失败时也刷新）。 */
  private async refreshProfilesQuietly() {
    try {
      await this.readProfiles();
    } catch {
      /* 已记录 */
    }
  }

  async enableProfile(iccid: string): Promise<void> {
    try {
      await this.run('profile.enable', '启用 Profile', true, (svc) => svc.enableProfile(iccid));
    } finally {
      if (this.transport.connected) await this.refreshProfilesQuietly();
    }
  }

  async disableProfile(iccid: string): Promise<void> {
    try {
      await this.run('profile.disable', '停用 Profile', true, (svc) => svc.disableProfile(iccid));
    } finally {
      if (this.transport.connected) await this.refreshProfilesQuietly();
    }
  }

  async deleteProfile(iccid: string): Promise<void> {
    try {
      await this.run('profile.delete', '删除 Profile', true, (svc) => svc.deleteProfile(iccid));
    } finally {
      if (this.transport.connected) await this.refreshProfilesQuietly();
    }
  }

  async setNickname(iccid: string, nickname: string): Promise<void> {
    try {
      await this.run('profile.nickname', '修改昵称', true, (svc) => svc.setNickname(iccid, nickname));
    } finally {
      if (this.transport.connected) await this.refreshProfilesQuietly();
    }
  }

  async downloadProfile(request: DownloadRequest): Promise<void> {
    const iccidsBefore = this.state.card.profiles?.map((p) => p.iccid) ?? null;
    let ok = false;
    let failure: unknown = null;
    try {
      await this.run('profile.download', '下载并安装 eSIM', true, (svc, setProgress) => svc.downloadProfile(request, { onProgress: setProgress }));
      ok = true;
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      let notificationsAfter: EuiccNotification[] | null = null;
      if (this.transport.connected) {
        // 无论成功失败都重新读取，让界面显示卡上的真实状态（都是只读命令）
        await this.refreshProfilesQuietly();
        const wroteToCard = ok || (failure instanceof LpacError && failure.functionName === 'es10b_load_bound_profile_package');
        if (wroteToCard) {
          try {
            notificationsAfter = await this.readNotifications();
          } catch {
            /* 已记录 */
          }
        }
      }
      const after = this.state.card.profiles ?? [];
      const report: DownloadReport = {
        at: Date.now(),
        ok,
        failedStage: failure instanceof LpacError ? failure.functionName : null,
        error: failure ? redactText(errorMessage(failure)) : null,
        iccidsBefore,
        newProfiles: iccidsBefore ? after.filter((p) => !iccidsBefore.includes(p.iccid)) : [],
        notificationsAfter,
      };
      this.update((s) => ({ ...s, lastDownload: report }));
      if (!ok && report.newProfiles.length > 0) {
        this.logger.warn('app', `下载报告失败，但卡上出现了 ${report.newProfiles.length} 个新的 Profile，请在 Profiles 页面核对。`);
      }
    }
  }

  async processAllNotifications(remove: boolean): Promise<void> {
    try {
      await this.run('notification.process', remove ? '发送并移除全部通知' : '发送全部通知', true, (svc, setProgress) => svc.processAllNotifications(remove, { onProgress: setProgress }));
    } finally {
      if (this.transport.connected) await this.readNotifications().catch(() => undefined);
    }
  }

  async removeAllNotifications(): Promise<void> {
    try {
      await this.run('notification.remove', '移除全部通知', true, (svc, setProgress) => svc.removeAllNotifications({ onProgress: setProgress }));
    } finally {
      if (this.transport.connected) await this.readNotifications().catch(() => undefined);
    }
  }

  /**
   * 设置读卡器 Wi-Fi。固件不回复 setWifiInfo，所以随后轮询 getWifiInfo 确认连接结果。
   * 密码只经过内存，不写日志、不保存。
   */
  async setWifi(ssid: string, password: string): Promise<WifiInfo> {
    return this.run('device.setWifi', '设置读卡器 Wi-Fi', true, async (svc) => {
      await svc.setWifi(ssid, password);
      let wifi: WifiInfo | null = null;
      for (const wait of [3000, 4000, 5000, 6000]) {
        await sleep(wait);
        if (!this.transport.connected) throw new DisconnectedError();
        try {
          wifi = await svc.getWifiInfo();
          this.update((s) => ({ ...s, device: { ...s.device, wifi: wifi!, updatedAt: Date.now() } }));
          if (wifi.connected && wifi.ssid === ssid) break;
        } catch (error) {
          this.logger.warn('app', `确认 Wi-Fi 状态失败：${errorMessage(error)}`);
        }
      }
      if (!wifi) throw new ResponseTimeoutError('确认 Wi-Fi 状态', 18000);
      return wifi;
    });
  }

  // ---------------------------------------------------------- diagnostics

  /** 诊断控制台：只允许白名单中的只读命令。 */
  async runReadOnlyCommand(input: ReadOnlyCommandId | string): Promise<unknown> {
    const id = classifyConsoleCommand(input);
    switch (id) {
      case 'getElpaInfo':
        await this.refreshDevice();
        return this.state.device.info;
      case 'getWifiInfo':
        return this.refreshWifi();
      case 'version':
        return this.readLpacVersion();
      case 'chipInfo':
        return this.readChipInfo();
      case 'profileList':
        return this.readProfiles();
      case 'notificationList':
        return this.readNotifications();
    }
  }

  getProtocolSummary() {
    return {
      service: this.service?.protocol ?? null,
      capabilities: this.service?.capabilities ?? null,
      legacyCommands: Object.values(LEGACY_COMMANDS).map((c) => ({ id: c.id, label: c.label, readOnly: c.readOnly, source: c.source })),
      sample: { chipInfo: commandBuilders.chipInfo(), profileList: commandBuilders.profileList() },
    };
  }

  isUnsupported(error: unknown): boolean {
    return error instanceof UnsupportedOperationError;
  }

  isValidationError(error: unknown): boolean {
    return error instanceof CommandValidationError;
  }

  async dispose(): Promise<void> {
    if (this.staleTimer) clearInterval(this.staleTimer);
    await this.transport.dispose();
  }
}
