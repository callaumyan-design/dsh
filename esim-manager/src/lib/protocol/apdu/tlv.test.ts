import { describe, expect, it } from 'vitest';
import { parseProfileInfoList } from './ApduJsonAdapter';
import { bytesToHex, decodeSwappedBcd, encodeTlv, findTlv, hexToBytes, parseTlvs, TlvError } from './tlv';

const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

describe('BER-TLV', () => {
  it('解析多字节标签与长格式长度', () => {
    const value = new Uint8Array(200).fill(0xab);
    const der = encodeTlv(0xbf2d, encodeTlv(0xa0, encodeTlv(0x94, value)));
    const nodes = parseTlvs(der);
    expect(nodes[0]?.tag).toBe(0xbf2d);
    expect(findTlv(findTlv(nodes[0]?.children, 0xa0)?.children, 0x94)?.value.length).toBe(200);
  });

  it('截断的数据抛错', () => {
    expect(() => parseTlvs(hexToBytes('5A0A0102'))).toThrow(TlvError);
  });

  it('ICCID 半字节交换解码', () => {
    expect(decodeSwappedBcd(hexToBytes('98684021436587092143'))).toBe('89860412345678901234');
    expect(decodeSwappedBcd(hexToBytes('9868402143658709F1'))).toBe('8986041234567890' + '1'); // F 填充
  });

  it('解析 ProfileInfoListResponse', () => {
    const e3 = encodeTlv(
      0xe3,
      cat(
        encodeTlv(0x5a, hexToBytes('98684021436587092143')),
        encodeTlv(0x4f, hexToBytes('A0000005591010FFFFFFFF8900001000')),
        encodeTlv(0x9f70, [1]),
        encodeTlv(0x90, new TextEncoder().encode('主号')),
        encodeTlv(0x91, new TextEncoder().encode('Carrier')),
        encodeTlv(0x92, new TextEncoder().encode('Plan')),
        encodeTlv(0x95, [2]),
      ),
    );
    const resp = encodeTlv(0xbf2d, encodeTlv(0xa0, e3));
    const [p] = parseProfileInfoList(resp);
    expect(p).toMatchObject({ iccid: '89860412345678901234', state: 'enabled', nickname: '主号', serviceProviderName: 'Carrier', profileName: 'Plan', profileClass: 'operational' });
    expect(bytesToHex(hexToBytes('0a0B'))).toBe('0A0B');
  });

  it('ProfileInfoListError', () => {
    expect(() => parseProfileInfoList(encodeTlv(0xbf2d, encodeTlv(0x81, [127])))).toThrow(/127/);
  });
});
