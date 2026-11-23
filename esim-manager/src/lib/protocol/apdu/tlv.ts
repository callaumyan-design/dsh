/**
 * 最小 BER-TLV 解析（ISO/IEC 8825-1），用于解析 ES10x 回复。
 * 只支持确定长度编码；遇到格式错误抛出异常而不是猜测。
 */

export interface Tlv {
  tag: number;
  constructed: boolean;
  value: Uint8Array;
  children: Tlv[] | null;
}

export class TlvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TlvError';
  }
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, '');
  if (clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) throw new TlvError(`非法十六进制字符串（长度 ${clean.length}）`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s.toUpperCase();
}

export function parseTlvs(bytes: Uint8Array): Tlv[] {
  const out: Tlv[] = [];
  let i = 0;
  while (i < bytes.length) {
    // 跳过 00 / FF 填充
    if (bytes[i] === 0x00 || bytes[i] === 0xff) {
      i++;
      continue;
    }
    const first = bytes[i]!;
    let tag = first;
    i++;
    if ((first & 0x1f) === 0x1f) {
      let more = true;
      let guard = 0;
      while (more) {
        if (i >= bytes.length) throw new TlvError('TLV 标签被截断');
        const b = bytes[i++]!;
        tag = (tag << 8) | b;
        more = (b & 0x80) !== 0;
        if (++guard > 3) throw new TlvError('TLV 标签过长');
      }
    }
    if (i >= bytes.length) throw new TlvError('TLV 长度缺失');
    let len = bytes[i++]!;
    if (len & 0x80) {
      const count = len & 0x7f;
      if (count === 0 || count > 3) throw new TlvError('不支持的 TLV 长度编码');
      if (i + count > bytes.length) throw new TlvError('TLV 长度被截断');
      len = 0;
      for (let k = 0; k < count; k++) len = (len << 8) | bytes[i++]!;
    }
    if (i + len > bytes.length) throw new TlvError(`TLV 值被截断（需要 ${len} 字节，剩余 ${bytes.length - i}）`);
    const value = bytes.subarray(i, i + len);
    i += len;
    const constructed = (first & 0x20) !== 0;
    out.push({ tag, constructed, value, children: constructed ? parseTlvs(value) : null });
  }
  return out;
}

export function findTlv(nodes: readonly Tlv[] | null | undefined, tag: number): Tlv | undefined {
  return nodes?.find((n) => n.tag === tag);
}

export function encodeLength(len: number): number[] {
  if (len < 0x80) return [len];
  if (len <= 0xff) return [0x81, len];
  if (len <= 0xffff) return [0x82, len >> 8, len & 0xff];
  throw new TlvError('TLV 值过长');
}

export function encodeTlv(tag: number, value: Uint8Array | number[]): Uint8Array {
  const tagBytes: number[] = [];
  let t = tag;
  do {
    tagBytes.unshift(t & 0xff);
    t >>>= 8;
  } while (t > 0);
  const v = value instanceof Uint8Array ? [...value] : value;
  return new Uint8Array([...tagBytes, ...encodeLength(v.length), ...v]);
}

/** ICCID 在卡内以“半字节交换”的 BCD 存储，F 为填充。 */
export function decodeSwappedBcd(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) {
    s += (b & 0x0f).toString(16);
    s += ((b >> 4) & 0x0f).toString(16);
  }
  return s.replace(/f+$/i, '').toUpperCase();
}

export const utf8 = (bytes: Uint8Array) => new TextDecoder('utf-8').decode(bytes);

export function bytesToInt(bytes: Uint8Array): number {
  let v = 0;
  for (const b of bytes) v = v * 256 + b;
  return v;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
