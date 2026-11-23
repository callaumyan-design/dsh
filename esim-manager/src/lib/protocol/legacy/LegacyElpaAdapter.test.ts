import { afterEach, describe, expect, it, vi } from 'vitest';
import { FirmwareSimulator } from '@/test/firmwareSimulator';
import { CardNotInsertedError, LpacError, ResponseTimeoutError } from '../errors';
import type { IncomingMessage, MessageLink } from '../link';
import { classifyMessage } from '../messages';
import { JsonMessageStream } from '../stream';
import { LEGACY_COMMANDS, commandBuilders } from './commands';
import { LegacyElpaAdapter } from './LegacyElpaAdapter';

/** 直接把适配器接到模拟器上（不经过 BLE），用于测试回复匹配规则。 */
function linkTo(sim: FirmwareSimulator): MessageLink & { sent: string[] } {
  const listeners = new Set<(m: IncomingMessage) => void>();
  const stream = new JsonMessageStream();
  sim.attach((chunk) => {
    for (const e of stream.push(chunk)) {
      if (e.kind === 'json') for (const l of [...listeners]) l({ message: classifyMessage(e.value), text: e.text, at: Date.now() });
    }
  });
  const sent: string[] = [];
  return {
    sent,
    send: async (text) => {
      sent.push(text);
      sim.write(new TextEncoder().encode(text));
    },
    onMessage: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    isConnected: () => true,
  };
}

afterEach(() => vi.useRealTimers());

describe('LegacyElpaAdapter', () => {
  it('chip info → chipInfo', async () => {
    const sim = new FirmwareSimulator();
    const a = new LegacyElpaAdapter(linkTo(sim));
    const r = await a.requestCli(LEGACY_COMMANDS.chipInfo, commandBuilders.chipInfo());
    expect(r.dataType).toBe('chipInfo');
    expect((r.data as { eidValue: string }).eidValue).toBe(sim.eid);
    expect(sim.handled).toEqual(['lpac chip info']);
  });

  it('JSON 命令按 cmd 匹配回复', async () => {
    const sim = new FirmwareSimulator();
    const a = new LegacyElpaAdapter(linkTo(sim));
    const m = await a.requestJson(LEGACY_COMMANDS.getElpaInfo, commandBuilders.getElpaInfo());
    expect(m.type).toBe('elpaInfo');
    expect(m.data.software).toBe('2.2.1');
  });

  it('未插卡 → CardNotInsertedError', async () => {
    const sim = new FirmwareSimulator({ cardInserted: false });
    const a = new LegacyElpaAdapter(linkTo(sim));
    await expect(a.requestCli(LEGACY_COMMANDS.profileList, commandBuilders.profileList())).rejects.toBeInstanceOf(CardNotInsertedError);
  });

  it('euicc_init 失败不终止，等待后续的真正错误', async () => {
    const sim = new FirmwareSimulator({ euiccInitFails: true });
    const a = new LegacyElpaAdapter(linkTo(sim));
    const err = await a.requestCli(LEGACY_COMMANDS.chipInfo, commandBuilders.chipInfo()).catch((e) => e);
    expect(err).toBeInstanceOf(LpacError);
    expect((err as LpacError).functionName).toBe('es10c_get_eid');
  });

  it('lpac 错误带原因', async () => {
    const sim = new FirmwareSimulator();
    const a = new LegacyElpaAdapter(linkTo(sim));
    const err = await a.requestCli(LEGACY_COMMANDS.deleteProfile, commandBuilders.deleteProfile('8944476500001234567')).catch((e) => e);
    expect(err).toBeInstanceOf(LpacError);
    expect((err as LpacError).detail).toBe('profile not in disabled state');
    expect((err as Error).message).toContain('删除 Profile 失败');
  });

  it('下载：转发进度并在成功时结束', async () => {
    const sim = new FirmwareSimulator();
    const a = new LegacyElpaAdapter(linkTo(sim));
    const steps: number[] = [];
    await a.requestCli(LEGACY_COMMANDS.downloadProfile, commandBuilders.downloadProfile({ smdp: 'rsp.example.com', matchingId: 'MID', confirmationCode: null }), {
      onProgress: (p) => steps.push(p.step ?? -1),
    });
    expect(steps).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(sim.profiles).toHaveLength(3);
  });

  it('没有回复（例如缺少程序名的 "chip info"）→ 超时', async () => {
    vi.useFakeTimers();
    const sim = new FirmwareSimulator();
    const a = new LegacyElpaAdapter(linkTo(sim));
    const p = a.requestCli({ ...LEGACY_COMMANDS.chipInfo, timeoutMs: 1000 }, 'chip info');
    const assertion = expect(p).rejects.toBeInstanceOf(ResponseTimeoutError);
    await vi.advanceTimersByTimeAsync(1500);
    await assertion;
  });

  it('请求严格串行：第二条命令在第一条完成后才发送', async () => {
    const sim = new FirmwareSimulator();
    const link = linkTo(sim);
    const order: string[] = [];
    const a = new LegacyElpaAdapter({ ...link, send: async (t, o) => (order.push(`send:${t}`), link.send(t, o)) });
    const p1 = a.requestCli(LEGACY_COMMANDS.chipInfo, commandBuilders.chipInfo()).then(() => order.push('done:chip'));
    const p2 = a.requestCli(LEGACY_COMMANDS.profileList, commandBuilders.profileList()).then(() => order.push('done:list'));
    await Promise.all([p1, p2]);
    expect(order).toEqual(['send:lpac chip info', 'done:chip', 'send:lpac profile list', 'done:list']);
  });

  it('迟到的其他 dataType 被忽略而不是被当作结果', async () => {
    const strays: string[] = [];
    const sim = new FirmwareSimulator();
    const link = linkTo(sim);
    const a = new LegacyElpaAdapter(link, { onStray: (_m, reason) => strays.push(reason) });
    const p = a.requestCli(LEGACY_COMMANDS.profileList, commandBuilders.profileList());
    // 模拟一个迟到的 chipInfo
    sim.write(new TextEncoder().encode('lpac chip info'));
    const r = await p;
    expect(r.dataType).toBe('profileList');
  });

  it('abortAll 立即中止在途请求', async () => {
    const sim = new FirmwareSimulator();
    const a = new LegacyElpaAdapter({ ...linkTo(sim), send: async () => undefined });
    const p = a.requestCli(LEGACY_COMMANDS.chipInfo, commandBuilders.chipInfo());
    await Promise.resolve();
    a.abortAll(new Error('gone'));
    await expect(p).rejects.toThrow('gone');
  });
});
