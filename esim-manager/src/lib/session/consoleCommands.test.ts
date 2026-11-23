import { describe, expect, it } from 'vitest';
import { classifyConsoleCommand, ConsoleCommandRejected } from './consoleCommands';

describe('console whitelist', () => {
  it('允许只读命令', () => {
    expect(classifyConsoleCommand('lpac chip info')).toBe('chipInfo');
    expect(classifyConsoleCommand('chip info')).toBe('chipInfo');
    expect(classifyConsoleCommand('  lpac   profile list ')).toBe('profileList');
    expect(classifyConsoleCommand('{"cmd":"getElpaInfo"}')).toBe('getElpaInfo');
    expect(classifyConsoleCommand('version')).toBe('version');
  });

  it('拒绝写入 / 危险命令', () => {
    for (const cmd of [
      'lpac profile delete 8986012345678901234',
      'lpac profile enable 8986012345678901234',
      'lpac chip purge yes',
      'lpac chip defaultsmdp a.com',
      'lpac profile download -s a.com',
      'lpac notification process -a',
      '{"cmd":"setWifiInfo","ssid":"a","password":"b"}',
      '{"cmd":"upgradeSoftware"}',
      '{"cmd":"checkUpdate"}',
      '{"cmd":"APDU","action":0}',
      '{"cmd":"getElpaInfo","url":"x"}',
    ]) {
      expect(() => classifyConsoleCommand(cmd), cmd).toThrow(ConsoleCommandRejected);
    }
  });
});
