import { describe, expect, it } from 'vitest';
import { HIDDEN, maskId, redactCommand, redactJsonForLog, redactText, redactValue } from './redact';

describe('redact', () => {
  it('隐藏 getElpaInfo 中的 Wi-Fi 密码，部分隐藏 SSID 与 MAC', () => {
    const msg = { cmd: 'getElpaInfo', data: { ssid: 'MyHome', password: 'hunter2', mac: '3485188a1b2c', software: '2.2.1' } };
    const out = redactValue(msg) as { data: Record<string, string> };
    expect(out.data.password).toBe(HIDDEN);
    expect(out.data.ssid).toBe('M•••');
    expect(out.data.mac).toBe('3485••••');
    expect(out.data.software).toBe('2.2.1');
    expect(redactJsonForLog(msg)).not.toContain('hunter2');
  });

  it('EID / ICCID 只保留前后 4 位', () => {
    expect(maskId('89049032123451234512345678901235')).toBe('8904••••••••••••1235');
    const out = redactValue({ eidValue: '89049032123451234512345678901235', iccid: '8986012345678901234' }) as Record<string, string>;
    expect(out.eidValue).not.toContain('12345123');
    expect(out.iccid?.startsWith('8986')).toBe(true);
    expect(out.iccid?.endsWith('1234')).toBe(true);
  });

  it('正则脱敏处理被截断的密码字段与裸露的 ID', () => {
    expect(redactText('{"cmd":"getWifiInfo","data":{"ssid":"a","password":"abc')).not.toContain('abc');
    expect(redactText('{"password":"a\\"b"}')).toBe(`{"password":"${HIDDEN}"}`);
    expect(redactText('EID 89049032123451234512345678901235')).not.toContain('2345123451234567');
    expect(redactText('LPA:1$rsp.example.com$SECRET-ID')).not.toContain('SECRET-ID');
  });

  it('命令脱敏：setWifiInfo、download 参数、ICCID', () => {
    expect(redactCommand('{"cmd":"setWifiInfo","ssid":"Home","password":"p@ss"}')).not.toContain('p@ss');
    const dl = redactCommand('lpac profile download -s rsp.example.com -m MATCH-123 -c 9999');
    expect(dl).toContain('rsp.example.com');
    expect(dl).not.toContain('MATCH-123');
    expect(dl).not.toContain('9999');
    expect(redactCommand('lpac profile enable 8986012345678901234')).toBe('lpac profile enable 8986•••••••••••1234');
  });

  it('长图标只记录长度', () => {
    const out = redactValue({ icon: 'A'.repeat(100) }) as Record<string, string>;
    expect(out.icon).toContain('100');
  });
});
