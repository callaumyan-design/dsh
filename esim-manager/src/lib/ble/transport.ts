import { Emitter } from '@/lib/emitter';
import { errorMessage, withTimeout } from '@/lib/utils';
import { DEVICE_NAME, NUS_RX_UUID, NUS_SERVICE_UUID, NUS_TX_UUID, WEB_BLUETOOTH_MAX_WRITE } from './constants';

export type TransportState = 'idle' | 'requesting' | 'connecting' | 'connected' | 'disconnecting' | 'disconnected';

/** 设备选择器的过滤方式。 */
export type RequestMode =
  /** 按名称 eSIM_Writer / 前缀 eSIM 以及 NUS 服务过滤（推荐）。 */
  | 'filtered'
  /** 显示所有附近设备（广播名不同或被系统缓存成别的名字时使用）。 */
  | 'all';

export interface CharacteristicSummary {
  uuid: string;
  write: boolean;
  writeWithoutResponse: boolean;
  notify: boolean;
  indicate: boolean;
  read: boolean;
}

export interface GattSummary {
  serviceUuid: string;
  rx: CharacteristicSummary;
  tx: CharacteristicSummary;
  notifying: boolean;
}

export interface TransportInfo {
  state: TransportState;
  deviceName: string | null;
  deviceId: string | null;
  gatt: GattSummary | null;
  /** 上次断开是否由用户主动发起。 */
  userInitiatedDisconnect: boolean;
  lastError: string | null;
}

export interface TransportLog {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
}

export type TransportEvents = {
  state: TransportInfo;
  /** 一次 characteristicvaluechanged 通知的原始字节（未解码）。 */
  data: Uint8Array;
  log: TransportLog;
};

export class TransportError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'unsupported'
      | 'cancelled'
      | 'not-found'
      | 'security'
      | 'gatt'
      | 'service-missing'
      | 'characteristic-missing'
      | 'not-connected'
      | 'too-long'
      | 'write-failed',
  ) {
    super(message);
    this.name = 'TransportError';
  }
}

const GATT_CONNECT_TIMEOUT = 20_000;
const GATT_OP_TIMEOUT = 10_000;
const WRITE_TIMEOUT = 10_000;

function summarize(c: BluetoothRemoteGATTCharacteristic): CharacteristicSummary {
  const p = c.properties;
  return {
    uuid: c.uuid,
    write: !!p.write,
    writeWithoutResponse: !!p.writeWithoutResponse,
    notify: !!p.notify,
    indicate: !!p.indicate,
    read: !!p.read,
  };
}

/** 把 DOMException 等翻译成中文说明。 */
export function describeBluetoothError(error: unknown): TransportError {
  if (error instanceof TransportError) return error;
  const name = (error as { name?: string } | null)?.name ?? '';
  const message = errorMessage(error);
  switch (name) {
    case 'NotFoundError':
      if (/cancel/i.test(message)) return new TransportError('已取消设备选择。', 'cancelled');
      return new TransportError(`未找到设备或服务：${message}`, 'not-found');
    case 'SecurityError':
      return new TransportError(`浏览器拒绝了蓝牙访问（需要安全上下文和用户手势）：${message}`, 'security');
    case 'NotSupportedError':
      return new TransportError(`浏览器或系统不支持此操作：${message}`, 'unsupported');
    case 'NetworkError':
      return new TransportError(`GATT 连接失败或已断开：${message}`, 'gatt');
    case 'NotAllowedError':
      return new TransportError(`操作未被允许：${message}`, 'security');
    default:
      return new TransportError(message, 'gatt');
  }
}

/**
 * Web Bluetooth 传输层：负责设备选择、GATT 连接、服务/特征发现、通知订阅、
 * 串行写入队列、断开检测、重连和资源释放。
 *
 * 不做任何协议层面的事：收到的通知原样以字节发出，写入的内容由上层决定。
 */
export class BleTransport {
  readonly events = new Emitter<TransportEvents>();

  private device: BluetoothDevice | null = null;
  private rx: BluetoothRemoteGATTCharacteristic | null = null;
  private tx: BluetoothRemoteGATTCharacteristic | null = null;
  private gattSummary: GattSummary | null = null;
  private state: TransportState = 'idle';
  private userInitiatedDisconnect = false;
  private lastError: string | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  /** 每次连接递增，用来丢弃过期连接的回调。 */
  private generation = 0;

  constructor(private readonly bluetooth: Bluetooth | undefined = typeof navigator !== 'undefined' ? navigator.bluetooth : undefined) {}

  get info(): TransportInfo {
    return {
      state: this.state,
      deviceName: this.device?.name ?? null,
      deviceId: this.device?.id ?? null,
      gatt: this.gattSummary,
      userInitiatedDisconnect: this.userInitiatedDisconnect,
      lastError: this.lastError,
    };
  }

  get connected(): boolean {
    return this.state === 'connected' && !!this.device?.gatt?.connected && !!this.rx;
  }

  get hasDevice(): boolean {
    return this.device !== null;
  }

  private log(level: TransportLog['level'], message: string) {
    this.events.emit('log', { level, message });
  }

  private setState(state: TransportState, error?: string | null) {
    this.state = state;
    if (error !== undefined) this.lastError = error;
    this.events.emit('state', this.info);
  }

  /** 打开浏览器的设备选择器。必须在用户点击等手势中调用。 */
  async requestDevice(mode: RequestMode = 'filtered'): Promise<BluetoothDevice> {
    if (!this.bluetooth) throw new TransportError('此浏览器不支持 Web Bluetooth。', 'unsupported');
    const options: RequestDeviceOptions =
      mode === 'all'
        ? { acceptAllDevices: true, optionalServices: [NUS_SERVICE_UUID] }
        : {
            // 官方固件没有在广播包里加入服务 UUID（只调用了 getAdvertising()->start()），
            // 所以主要靠名称过滤；服务过滤用于兼容会广播 NUS 的其他固件。
            filters: [{ name: DEVICE_NAME }, { namePrefix: 'eSIM' }, { services: [NUS_SERVICE_UUID] }],
            optionalServices: [NUS_SERVICE_UUID],
          };
    const prev = this.state;
    this.setState('requesting');
    this.log('info', mode === 'all' ? '打开设备选择器（显示所有设备）' : `打开设备选择器（过滤：名称 ${DEVICE_NAME} / 前缀 eSIM / NUS 服务）`);
    try {
      const device = await this.bluetooth.requestDevice(options);
      this.log('info', `用户选择了设备：${device.name ?? '(无名称)'}`);
      if (this.device && this.device !== device) await this.disconnect();
      this.device = device;
      return device;
    } catch (error) {
      const err = describeBluetoothError(error);
      this.setState(prev === 'connected' ? 'connected' : this.device ? 'disconnected' : 'idle', err.code === 'cancelled' ? null : err.message);
      this.log(err.code === 'cancelled' ? 'info' : 'error', err.message);
      throw err;
    }
  }

  /** 选择设备并连接。 */
  async requestAndConnect(mode: RequestMode = 'filtered'): Promise<void> {
    await this.requestDevice(mode);
    await this.connect();
  }

  /** 连接（或重新连接）当前已选择的设备，并完成服务发现与通知订阅。 */
  async connect(): Promise<void> {
    const device = this.device;
    if (!device) throw new TransportError('尚未选择设备。', 'not-connected');
    if (!device.gatt) throw new TransportError('该设备不支持 GATT。', 'unsupported');

    const generation = ++this.generation;
    this.userInitiatedDisconnect = false;
    this.cleanupCharacteristics();
    device.removeEventListener('gattserverdisconnected', this.handleDisconnected);
    device.addEventListener('gattserverdisconnected', this.handleDisconnected);
    this.setState('connecting', null);

    try {
      this.log('info', '正在建立 GATT 连接…');
      const server = await withTimeout(device.gatt.connect(), GATT_CONNECT_TIMEOUT, 'GATT 连接');
      this.assertGeneration(generation);
      this.log('info', `GATT 已连接，正在查找服务 ${NUS_SERVICE_UUID}`);

      let service: BluetoothRemoteGATTService;
      try {
        service = await withTimeout(server.getPrimaryService(NUS_SERVICE_UUID), GATT_OP_TIMEOUT, '服务发现');
      } catch (error) {
        throw new TransportError(
          `设备上没有找到 9eSIM 使用的 UART 服务（${NUS_SERVICE_UUID}）。这可能不是 9eSIM 读卡器。原始错误：${errorMessage(error)}`,
          'service-missing',
        );
      }
      this.assertGeneration(generation);

      let rx: BluetoothRemoteGATTCharacteristic;
      let tx: BluetoothRemoteGATTCharacteristic;
      try {
        rx = await withTimeout(service.getCharacteristic(NUS_RX_UUID), GATT_OP_TIMEOUT, '查找 RX 特征');
        tx = await withTimeout(service.getCharacteristic(NUS_TX_UUID), GATT_OP_TIMEOUT, '查找 TX 特征');
      } catch (error) {
        throw new TransportError(`找到了服务，但缺少 RX/TX 特征：${errorMessage(error)}`, 'characteristic-missing');
      }
      this.assertGeneration(generation);

      const rxSummary = summarize(rx);
      const txSummary = summarize(tx);
      this.log('info', `RX ${rx.uuid} 属性：${formatProps(rxSummary)}；TX ${tx.uuid} 属性：${formatProps(txSummary)}`);
      if (!rxSummary.write && !rxSummary.writeWithoutResponse) {
        throw new TransportError('RX 特征不支持写入，无法向设备发送命令。', 'characteristic-missing');
      }
      if (!txSummary.notify && !txSummary.indicate) {
        throw new TransportError('TX 特征不支持通知，无法接收设备回复。', 'characteristic-missing');
      }

      tx.addEventListener('characteristicvaluechanged', this.handleNotification);
      await withTimeout(tx.startNotifications(), GATT_OP_TIMEOUT, '订阅通知');
      this.assertGeneration(generation);

      this.rx = rx;
      this.tx = tx;
      this.gattSummary = { serviceUuid: service.uuid, rx: rxSummary, tx: txSummary, notifying: true };
      this.writeChain = Promise.resolve();
      this.log('info', '已订阅 TX 通知，连接就绪。');
      this.setState('connected', null);
    } catch (error) {
      if (generation !== this.generation) throw error; // 被更新的连接请求取代
      const err = describeBluetoothError(error);
      this.log('error', `连接失败：${err.message}`);
      this.cleanupCharacteristics();
      try {
        if (device.gatt.connected) device.gatt.disconnect();
      } catch {
        /* 忽略 */
      }
      this.setState('disconnected', err.message);
      throw err;
    }
  }

  /**
   * 写入一条完整命令。所有写入串行执行。
   *
   * @param maxBytes 协议允许的最大长度，超过直接抛错，绝不截断或拆分。
   */
  write(bytes: Uint8Array, maxBytes: number = WEB_BLUETOOTH_MAX_WRITE): Promise<void> {
    const run = async () => {
      const rx = this.rx;
      if (!rx || !this.connected) throw new TransportError('蓝牙未连接。', 'not-connected');
      if (bytes.length > maxBytes) {
        throw new TransportError(`命令长度 ${bytes.length} 字节超过上限 ${maxBytes} 字节，已拒绝发送（不会截断或分包）。`, 'too-long');
      }
      if (bytes.length > WEB_BLUETOOTH_MAX_WRITE) {
        throw new TransportError(`超过 Web Bluetooth 单次写入上限 ${WEB_BLUETOOTH_MAX_WRITE} 字节。`, 'too-long');
      }
      // 复制一份，避免调用方之后修改缓冲区
      const payload = new Uint8Array(bytes);
      try {
        if (this.gattSummary?.rx.write && typeof rx.writeValueWithResponse === 'function') {
          await withTimeout(rx.writeValueWithResponse(payload), WRITE_TIMEOUT, '写入');
        } else if (this.gattSummary?.rx.writeWithoutResponse && typeof rx.writeValueWithoutResponse === 'function') {
          await withTimeout(rx.writeValueWithoutResponse(payload), WRITE_TIMEOUT, '写入');
        } else {
          await withTimeout(rx.writeValue(payload), WRITE_TIMEOUT, '写入');
        }
      } catch (error) {
        const err = describeBluetoothError(error);
        throw new TransportError(`写入失败：${err.message}`, 'write-failed');
      }
    };
    const result = this.writeChain.then(run, run);
    this.writeChain = result.catch(() => undefined);
    return result;
  }

  /** 主动断开并释放资源。 */
  async disconnect(): Promise<void> {
    const device = this.device;
    this.userInitiatedDisconnect = true;
    this.generation++;
    if (!device) {
      this.setState('idle');
      return;
    }
    this.setState('disconnecting');
    const tx = this.tx;
    if (tx && device.gatt?.connected) {
      try {
        await withTimeout(tx.stopNotifications(), 3000, '取消订阅');
      } catch {
        /* 设备可能已经离开 */
      }
    }
    this.cleanupCharacteristics();
    try {
      if (device.gatt?.connected) device.gatt.disconnect();
    } catch {
      /* 忽略 */
    }
    this.log('info', '已断开蓝牙连接。');
    this.setState('disconnected');
  }

  /** 让浏览器忘记此设备的授权（Chrome 101+ 支持）。 */
  async forget(): Promise<void> {
    const device = this.device;
    await this.disconnect();
    if (device && typeof device.forget === 'function') {
      try {
        await device.forget();
        this.log('info', '已撤销浏览器对此设备的访问授权。');
      } catch (error) {
        this.log('warn', `撤销授权失败：${errorMessage(error)}`);
      }
    }
    if (device) device.removeEventListener('gattserverdisconnected', this.handleDisconnected);
    this.device = null;
    this.setState('idle');
  }

  /** 完全释放（组件卸载时调用）。 */
  async dispose(): Promise<void> {
    await this.disconnect();
    if (this.device) this.device.removeEventListener('gattserverdisconnected', this.handleDisconnected);
    this.device = null;
    this.events.clear();
  }

  private assertGeneration(generation: number) {
    if (generation !== this.generation) throw new TransportError('连接过程被中止。', 'cancelled');
  }

  private cleanupCharacteristics() {
    if (this.tx) this.tx.removeEventListener('characteristicvaluechanged', this.handleNotification);
    this.tx = null;
    this.rx = null;
    if (this.gattSummary) this.gattSummary = { ...this.gattSummary, notifying: false };
  }

  private handleNotification = (event: Event) => {
    const target = event.target as BluetoothRemoteGATTCharacteristic | null;
    const view = target?.value;
    if (!view) return;
    const bytes = new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
    this.events.emit('data', bytes);
  };

  private handleDisconnected = () => {
    const wasUser = this.userInitiatedDisconnect;
    this.cleanupCharacteristics();
    if (this.state === 'disconnected' && wasUser) return;
    this.log(wasUser ? 'info' : 'warn', wasUser ? 'GATT 已断开。' : 'GATT 连接意外断开（设备关机、超出范围或被系统断开）。');
    this.setState('disconnected', wasUser ? null : '蓝牙连接意外断开');
  };
}

function formatProps(s: CharacteristicSummary): string {
  const props = [
    s.write && 'write',
    s.writeWithoutResponse && 'writeWithoutResponse',
    s.notify && 'notify',
    s.indicate && 'indicate',
    s.read && 'read',
  ].filter(Boolean);
  return props.length ? props.join(', ') : '(无)';
}
