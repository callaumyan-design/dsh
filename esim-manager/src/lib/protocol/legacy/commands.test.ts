import { describe, expect, it } from 'vitest';
import { buildLpacCommand, CommandValidationError, commandBuilders, encodeCommand, validateNickname } from './commands';

describe('legacy commands', () => {
  it('lpac 命令以程序名开头（固件 applet_entry 从 argv[1] 开始匹配）', () => {
    expect(commandBuilders.chipInfo()).toBe('lpac chip info');
    expect(commandBuilders.profileList()).toBe('lpac profile list');
    expect(commandBuilders.enableProfile('8986012345678901234')).toBe('lpac profile enable 8986012345678901234');
    expect(commandBuilders.notificationProcessAll(true)).toBe('lpac notification process -a -r');
  });

  it('JSON 控制命令', () => {
    expect(commandBuilders.getElpaInfo()).toBe('{"cmd":"getElpaInfo"}');
    expect(JSON.parse(commandBuilders.setWifiInfo('Home "5G"', 'p w'))).toEqual({ cmd: 'setWifiInfo', ssid: 'Home "5G"', password: 'p w' });
  });

  it('超过 255 字节的命令被拒绝（不截断）', () => {
    expect(() => encodeCommand('x'.repeat(256))).toThrow(CommandValidationError);
    expect(encodeCommand('x'.repeat(255))).toHaveLength(255);
    // 多字节字符按 UTF-8 计算
    expect(() => encodeCommand('中'.repeat(86))).toThrow(CommandValidationError);
  });

  it('参数不能含空格 / 换行；参数个数受 argv[20] 限制', () => {
    expect(() => buildLpacCommand(['profile', 'nickname', '1', 'a b'])).toThrow(/空格/);
    expect(() => encodeCommand('lpac chip info\n')).toThrow(CommandValidationError);
    expect(() => buildLpacCommand(Array.from({ length: 20 }, () => 'a'))).toThrow(/argv/);
  });

  it('昵称校验', () => {
    expect(validateNickname('')).toBe('');
    expect(validateNickname('旅行卡')).toBe('旅行卡');
    expect(() => validateNickname('my sim')).toThrow(CommandValidationError);
    expect(() => validateNickname('字'.repeat(22))).toThrow(/64/);
    expect(commandBuilders.setNickname('8986012345678901234', '')).toBe('lpac profile nickname 8986012345678901234');
  });

  it('下载参数不能以 - 开头（download.c 用前缀匹配所有 argv）', () => {
    expect(() => commandBuilders.downloadProfile({ smdp: 'rsp.example.com', matchingId: '-s', confirmationCode: null })).toThrow(/-/);
    expect(commandBuilders.downloadProfile({ smdp: 'rsp.example.com', matchingId: 'ABC-123', confirmationCode: '1234' })).toBe('lpac profile download -s rsp.example.com -m ABC-123 -c 1234');
  });

  it('ICCID 校验', () => {
    expect(() => commandBuilders.deleteProfile('12345')).toThrow(/ICCID/);
    expect(() => commandBuilders.deleteProfile('8986 0123')).toThrow();
  });
});
