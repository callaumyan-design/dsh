import { describe, expect, it } from 'vitest';
import { ActivationCodeError, looksLikeActivationCode, parseActivationCode } from './activationCode';

describe('activation code', () => {
  it('标准格式', () => {
    expect(parseActivationCode('LPA:1$rsp.example.com$ABCD-1234')).toEqual({ smdp: 'rsp.example.com', matchingId: 'ABCD-1234', oid: null, confirmationCodeRequired: false });
  });

  it('没有 LPA: 前缀、大小写不敏感、首尾空白', () => {
    expect(parseActivationCode('  lpa:1$smdp.io$X  ').smdp).toBe('smdp.io');
    expect(parseActivationCode('1$smdp.io$X').matchingId).toBe('X');
  });

  it('空字段不会让后续字段错位（固件 strtok 的缺陷）', () => {
    const r = parseActivationCode('LPA:1$smdp.example.com$$1.3.6.1.4.1.31746$1');
    expect(r.matchingId).toBeNull();
    expect(r.oid).toBe('1.3.6.1.4.1.31746');
    expect(r.confirmationCodeRequired).toBe(true);
  });

  it('确认码标志', () => {
    expect(parseActivationCode('LPA:1$smdp.example.com$MID$$1').confirmationCodeRequired).toBe(true);
    expect(parseActivationCode('LPA:1$smdp.example.com$MID$$0').confirmationCodeRequired).toBe(false);
  });

  it('非法输入', () => {
    expect(() => parseActivationCode('')).toThrow(ActivationCodeError);
    expect(() => parseActivationCode('LPA:2$a.com$b')).toThrow(/AC_Format/);
    expect(() => parseActivationCode('LPA:1$a.com')).toThrow(/缺少/);
    expect(() => parseActivationCode('LPA:1$not a host$b')).toThrow();
    expect(() => parseActivationCode('LPA:1$https://a.com$b')).toThrow(/域名/);
    expect(() => parseActivationCode('LPA:1$a.com$-x')).toThrow(/-/);
  });

  it('looksLikeActivationCode', () => {
    expect(looksLikeActivationCode('LPA:1$a')).toBe(true);
    expect(looksLikeActivationCode('hello')).toBe(false);
  });
});
