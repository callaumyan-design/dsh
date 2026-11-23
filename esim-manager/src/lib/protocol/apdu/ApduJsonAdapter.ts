import { DisconnectedError, ProtocolError, ResponseTimeoutError } from '../errors';
import type { MessageLink } from '../link';
import type { EuiccProfile, ProfileClass, ProfileState } from '@/lib/euicc/types';
import { bytesToBase64, bytesToHex, bytesToInt, decodeSwappedBcd, findTlv, hexToBytes, parseTlvs, utf8 } from './tlv';

/**
 * NekokoLPA 所用的“APDU JSON”蓝牙协议适配器（src/lpa/adapters/SimLinkDevice.ts，
 * iebb/NekokoLPA @ 58ef9ec，MIT）：
 *
 *   {"cmd":"APDU","action":0}            打开（固件侧）APDU 通道
 *   {"cmd":"APDU","action":1,"data":hex}  透传一条 APDU，回复 {"data":"<hex+SW>"}
 *   {"cmd":"APDU","action":2}            关闭
 *   错误回复 {"error":"…"}，例如 "APDU channel not open!"
 *
 * ⚠️ 官方 eLPA 源码以及 MiniToolFirmware 的 V2.1.0 / V2.2.1 固件二进制中都 **没有**
 *    这个命令；向旧固件发送时会因为 cmd 不认识而被静默忽略（不会产生副作用）。
 *    本适配器只在用户手动选择时使用，状态为“待设备验证”。
 *
 * 本应用只实现只读操作：读取 EID（ES10c GetEUICCData，BF3E）与 Profile 列表
 * （ES10c ProfileInfoListRequest，BF2D）。写操作和下载未实现：
 * - 写操作需要先在真实设备上验证本协议；
 * - 下载需要浏览器直接访问 SM-DP+ 的 ES9+ 接口，而 SM-DP+ 不提供 CORS 头，
 *   浏览器无法完成，必须由设备或原生程序代理。
 */

const ACTION_OPEN = 0;
const ACTION_TRANSMIT = 1;
const ACTION_CLOSE = 2;
const CHANNEL_CLOSED_ERROR = 'APDU channel not open!';

/** NekokoLPA 注释：该固件 GET RESPONSE 请求超过 0x4F 字节会溢出。 */
const MAX_GET_RESPONSE = 0x4f;
/** NekokoLPA 对 ble_9el 设备使用 63 字节的 STORE DATA 分段。 */
const STORE_DATA_SEGMENT = 63;
const RAW_TIMEOUT = 8000;

/** SGP.22 ISD-R AID（GSMA 默认）以及 NekokoLPA 预置的其他厂商 AID。 */
export const ISD_R_AIDS = [
  'A0000005591010FFFFFFFF8900000100',
  'A0000005591010FFFFFFFF8900050500',
  'A0000005591010000000008900000300',
  'A0000005591010FFFFFFFF8900000177',
];

const APDU_TERMINAL_CAPABILITIES = '80AA00000AA9088100820101830107';
const APDU_MANAGE_CHANNEL_OPEN = '0070000001';

export class ApduError extends ProtocolError {
  constructor(message: string) {
    super(message);
    this.name = 'ApduError';
  }
}

function claFor(channel: number, base: number): string {
  const cla = channel <= 3 ? base | channel : base | 0x40 | (channel - 4);
  return cla.toString(16).toUpperCase().padStart(2, '0');
}

function sw(resp: string): string {
  return resp.slice(-4).toUpperCase();
}

export class ApduJsonAdapter {
  readonly id = 'apdu-json' as const;
  /** NekokoLPA 会按 MTU 分段写入，说明该固件可以重组；但未验证，这里仍保守限制。 */
  readonly maxCommandBytes = 255;
  private channel: number | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private current: { abort: (e: Error) => void } | null = null;

  constructor(private readonly link: MessageLink) {}

  abortAll(error: Error = new DisconnectedError()): void {
    this.current?.abort(error);
    this.channel = null;
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(task, task);
    this.chain = result.catch(() => undefined);
    return result;
  }

  /** 发送一条 APDU JSON 命令，等待 {"data"} / {"error"} 回复。 */
  private raw(obj: { cmd: 'APDU'; action: number; data?: string }, label: string): Promise<{ data: string | null; error: string | null }> {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (error: Error | null, value?: { data: string | null; error: string | null }) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        unsubscribe();
        this.current = null;
        if (error) reject(error);
        else resolve(value!);
      };
      const unsubscribe = this.link.onMessage(({ message }) => {
        if (message.type === 'apdu') finish(null, { data: message.data, error: message.error });
      });
      this.current = { abort: (e) => finish(e) };
      const timer = setTimeout(() => finish(new ResponseTimeoutError(label, RAW_TIMEOUT)), RAW_TIMEOUT);
      this.link.send(JSON.stringify(obj), { maxBytes: this.maxCommandBytes, label }).catch((e: Error) => finish(e));
    });
  }

  private async transmit(apdu: string, retried = false): Promise<string> {
    const reply = await this.raw({ cmd: 'APDU', action: ACTION_TRANSMIT, data: apdu }, 'APDU');
    if (reply.error === CHANNEL_CLOSED_ERROR && !retried) {
      await this.raw({ cmd: 'APDU', action: ACTION_OPEN }, 'APDU open');
      return this.transmit(apdu, true);
    }
    if (reply.error) throw new ApduError(`设备返回 APDU 错误：${reply.error}`);
    const data = (reply.data ?? '').toUpperCase();
    if (data.length < 4 || data.length % 2 !== 0) throw new ApduError(`APDU 回复格式异常（${data.length} 个十六进制字符）`);
    return data;
  }

  /**
   * 只读探测：发送关闭命令。旧固件会因为不认识 cmd 而不回复（超时 → 不是此协议）；
   * 支持此协议的固件会回复 {"data"} 或 {"error"}。
   */
  probe(): Promise<boolean> {
    return this.exclusive(async () => {
      try {
        await this.raw({ cmd: 'APDU', action: ACTION_CLOSE }, 'APDU 协议探测');
        return true;
      } catch (error) {
        if (error instanceof ResponseTimeoutError) return false;
        throw error;
      }
    });
  }

  /** 打开逻辑通道并选择 ISD-R。 */
  private async openSession(): Promise<void> {
    await this.raw({ cmd: 'APDU', action: ACTION_CLOSE }, 'APDU close');
    await this.raw({ cmd: 'APDU', action: ACTION_OPEN }, 'APDU open');
    await this.transmit(APDU_TERMINAL_CAPABILITIES);
    const resp = await this.transmit(APDU_MANAGE_CHANNEL_OPEN);
    if (!/^[0-9A-F]{2}9000$/.test(resp)) throw new ApduError(`打开逻辑通道失败（SW=${sw(resp)}）`);
    const channel = parseInt(resp.slice(0, 2), 16);
    if (channel < 1 || channel > 19) throw new ApduError(`卡片分配了无效的逻辑通道 ${channel}`);
    this.channel = channel;
    for (const aid of ISD_R_AIDS) {
      const select = await this.transmit(`${claFor(channel, 0x00)}A40400${(aid.length / 2).toString(16).padStart(2, '0').toUpperCase()}${aid}`);
      const s = sw(select);
      if (s === '9000' || s.startsWith('61')) return;
    }
    await this.closeSession();
    throw new ApduError('没有找到 ISD-R（卡片可能不是 eUICC）。');
  }

  private async closeSession(): Promise<void> {
    const ch = this.channel;
    this.channel = null;
    try {
      if (ch !== null) await this.transmit(`007080${ch.toString(16).toUpperCase().padStart(2, '0')}00`);
    } catch {
      /* 尽力而为 */
    }
    try {
      await this.raw({ cmd: 'APDU', action: ACTION_CLOSE }, 'APDU close');
    } catch {
      /* 尽力而为 */
    }
  }

  /** 发送一条 ES10x 请求（STORE DATA 分段 + GET RESPONSE 拼接）。 */
  private async es10(der: Uint8Array): Promise<Uint8Array> {
    const channel = this.channel;
    if (channel === null) throw new ApduError('逻辑通道未打开');
    const cla = claFor(channel, 0x80);
    let response = '';
    const segments = Math.max(1, Math.ceil(der.length / STORE_DATA_SEGMENT));
    for (let seq = 0; seq < segments; seq++) {
      const part = der.subarray(seq * STORE_DATA_SEGMENT, (seq + 1) * STORE_DATA_SEGMENT);
      const p1 = seq === segments - 1 ? '91' : '11';
      const apdu = `${cla}E2${p1}${seq.toString(16).padStart(2, '0').toUpperCase()}${part.length.toString(16).padStart(2, '0').toUpperCase()}${bytesToHex(part)}`;
      let resp = await this.transmit(apdu);
      let s = sw(resp);
      response += resp.slice(0, -4);
      let guard = 0;
      while (s.startsWith('61')) {
        if (++guard > 512) throw new ApduError('GET RESPONSE 次数过多');
        const remain = parseInt(s.slice(2), 16) || 256;
        const le = Math.min(remain, MAX_GET_RESPONSE);
        resp = await this.transmit(`${claFor(channel, 0x00)}C00000${le.toString(16).padStart(2, '0').toUpperCase()}`);
        s = sw(resp);
        response += resp.slice(0, -4);
      }
      if (s !== '9000') throw new ApduError(`ES10 命令失败（SW=${s}）`);
    }
    return hexToBytes(response);
  }

  private withSession<T>(task: () => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      await this.openSession();
      try {
        return await task();
      } finally {
        await this.closeSession();
      }
    });
  }

  /** ES10c GetEUICCData（BF3E { 5C 01 5A }）→ EID。 */
  getEid(): Promise<string> {
    return this.withSession(async () => {
      const resp = await this.es10(hexToBytes('BF3E035C015A'));
      const root = findTlv(parseTlvs(resp), 0xbf3e);
      const eid = findTlv(root?.children, 0x5a);
      if (!eid) throw new ApduError('回复中没有 EID');
      return bytesToHex(eid.value);
    });
  }

  /** ES10c ProfileInfoListRequest（BF2D 00）→ Profile 列表。 */
  listProfiles(): Promise<EuiccProfile[]> {
    return this.withSession(async () => parseProfileInfoList(await this.es10(hexToBytes('BF2D00'))));
  }
}

const PROFILE_STATE: Record<number, ProfileState> = { 0: 'disabled', 1: 'enabled' };
const PROFILE_CLASS: Record<number, ProfileClass> = { 0: 'test', 1: 'provisioning', 2: 'operational' };

/** 解析 ProfileInfoListResponse（SGP.22 §5.7.15）。 */
export function parseProfileInfoList(resp: Uint8Array): EuiccProfile[] {
  const root = findTlv(parseTlvs(resp), 0xbf2d);
  if (!root) throw new ApduError('回复不是 ProfileInfoListResponse');
  const err = findTlv(root.children, 0x81);
  if (err) throw new ApduError(`ProfileInfoListError ${bytesToInt(err.value)}`);
  const ok = findTlv(root.children, 0xa0);
  if (!ok) return [];
  return (ok.children ?? [])
    .filter((n) => n.tag === 0xe3)
    .map((info) => {
      const c = info.children ?? [];
      const iccid = findTlv(c, 0x5a);
      const aid = findTlv(c, 0x4f);
      const state = findTlv(c, 0x9f70);
      const nick = findTlv(c, 0x90);
      const spn = findTlv(c, 0x91);
      const name = findTlv(c, 0x92);
      const iconType = findTlv(c, 0x93);
      const icon = findTlv(c, 0x94);
      const cls = findTlv(c, 0x95);
      const iconTypeNum = iconType ? bytesToInt(iconType.value) : null;
      return {
        iccid: iccid ? decodeSwappedBcd(iccid.value) : '',
        isdpAid: aid ? bytesToHex(aid.value) : null,
        state: state ? (PROFILE_STATE[bytesToInt(state.value)] ?? 'unknown') : 'unknown',
        nickname: nick && nick.value.length ? utf8(nick.value) : null,
        serviceProviderName: spn && spn.value.length ? utf8(spn.value) : null,
        profileName: name && name.value.length ? utf8(name.value) : null,
        iconType: iconTypeNum === 0 ? 'jpeg' : iconTypeNum === 1 ? 'png' : iconTypeNum === null ? null : 'unknown',
        icon: icon && icon.value.length ? bytesToBase64(icon.value) : null,
        profileClass: cls ? (PROFILE_CLASS[bytesToInt(cls.value)] ?? 'unknown') : 'unknown',
      } satisfies EuiccProfile;
    });
}
