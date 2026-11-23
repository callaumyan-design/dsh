/**
 * 测试专用：最小化的 Web Bluetooth 伪实现，把写入转交给 FirmwareSimulator，
 * 把模拟器的 notify 变成 characteristicvaluechanged 事件。
 * **这是 Mock BLE，不是真实硬件。**
 */
import { NUS_RX_UUID, NUS_SERVICE_UUID, NUS_TX_UUID } from '@/lib/ble/constants';
import type { FirmwareSimulator } from './firmwareSimulator';

type Props = Partial<BluetoothCharacteristicProperties>;

class FakeCharacteristic extends EventTarget {
  value: DataView | undefined;
  notifying = false;
  readonly writes: Uint8Array[] = [];
  constructor(
    readonly uuid: string,
    readonly properties: Props,
    private readonly onWrite: (v: Uint8Array) => void,
  ) {
    super();
  }
  async writeValueWithResponse(value: BufferSource) {
    const bytes = new Uint8Array(value instanceof ArrayBuffer ? value : (value as ArrayBufferView).buffer.slice(0));
    this.writes.push(bytes);
    this.onWrite(bytes);
  }
  async writeValue(value: BufferSource) {
    return this.writeValueWithResponse(value);
  }
  async startNotifications() {
    this.notifying = true;
    return this;
  }
  async stopNotifications() {
    this.notifying = false;
    return this;
  }
  deliver(chunk: Uint8Array) {
    if (!this.notifying) return;
    this.value = new DataView(chunk.slice().buffer);
    this.dispatchEvent(new Event('characteristicvaluechanged'));
  }
}

class FakeService {
  constructor(
    readonly uuid: string,
    private readonly chars: FakeCharacteristic[],
  ) {}
  async getCharacteristic(uuid: string) {
    const c = this.chars.find((x) => x.uuid === uuid);
    if (!c) throw Object.assign(new Error(`No Characteristics matching UUID ${uuid}`), { name: 'NotFoundError' });
    return c;
  }
}

class FakeGatt {
  connected = false;
  constructor(
    private readonly device: FakeDevice,
    private readonly services: FakeService[],
  ) {}
  async connect() {
    if (this.device.failConnect) throw Object.assign(new Error('Connection failed for unknown reason.'), { name: 'NetworkError' });
    this.connected = true;
    return this;
  }
  disconnect() {
    if (!this.connected) return;
    this.connected = false;
    this.device.dispatchEvent(new Event('gattserverdisconnected'));
  }
  async getPrimaryService(uuid: string) {
    if (!this.connected) throw Object.assign(new Error('GATT Server is disconnected.'), { name: 'NetworkError' });
    const s = this.services.find((x) => x.uuid === uuid);
    if (!s) throw Object.assign(new Error(`No Services matching UUID ${uuid} found in Device.`), { name: 'NotFoundError' });
    return s;
  }
}

export class FakeDevice extends EventTarget {
  readonly id = 'fake-device-id';
  readonly gatt: FakeGatt;
  readonly rx: FakeCharacteristic;
  readonly tx: FakeCharacteristic;
  failConnect = false;
  forgotten = false;

  constructor(
    readonly name: string,
    sim: FirmwareSimulator,
    options: { withService?: boolean } = {},
  ) {
    super();
    this.rx = new FakeCharacteristic(NUS_RX_UUID, { write: true }, (v) => sim.write(v));
    this.tx = new FakeCharacteristic(NUS_TX_UUID, { notify: true, read: true }, () => undefined);
    sim.attach((chunk) => setTimeout(() => this.tx.deliver(chunk), 0));
    const services = options.withService === false ? [] : [new FakeService(NUS_SERVICE_UUID, [this.rx, this.tx])];
    this.gatt = new FakeGatt(this, services);
  }

  async forget() {
    this.forgotten = true;
  }

  /** 模拟设备断电 / 走出范围。 */
  simulateLinkLoss() {
    this.gatt.disconnect();
  }
}

export class FakeBluetooth {
  lastOptions: RequestDeviceOptions | null = null;
  cancel = false;
  constructor(readonly device: FakeDevice) {}
  async requestDevice(options: RequestDeviceOptions) {
    this.lastOptions = options;
    if (this.cancel) throw Object.assign(new Error('User cancelled the requestDevice() chooser.'), { name: 'NotFoundError' });
    return this.device;
  }
  async getAvailability() {
    return true;
  }
}

export function makeFakeBluetooth(sim: FirmwareSimulator, options: { name?: string; withService?: boolean } = {}) {
  const device = new FakeDevice(options.name ?? 'eSIM_Writer', sim, options);
  return { bluetooth: new FakeBluetooth(device) as unknown as Bluetooth & FakeBluetooth, device };
}

/** 等待所有排队的 setTimeout(0) 与微任务。 */
export async function flushAsync(rounds = 20) {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0));
}
