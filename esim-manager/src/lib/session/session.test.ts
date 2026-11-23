import { describe, expect, it } from 'vitest';
import { BleTransport } from '@/lib/ble/transport';
import { NUS_SERVICE_UUID } from '@/lib/ble/constants';
import { evaluateSupport } from '@/lib/ble/support';
import { CardNotInsertedError, LpacError } from '@/lib/protocol/errors';
import { FirmwareSimulator } from '@/test/firmwareSimulator';
import { flushAsync, makeFakeBluetooth } from '@/test/fakeBluetooth';
import { SessionController } from './session';

/**
 * Mock BLE 集成测试：BleTransport + 伪 Web Bluetooth + 固件模拟器。
 * 验证的是本应用的实现与 **源码推导出的** 固件行为一致，不等于真实硬件验证。
 */
function setup(simOptions: ConstructorParameters<typeof FirmwareSimulator>[0] = {}, fakeOptions: { name?: string; withService?: boolean } = {}) {
  const sim = new FirmwareSimulator(simOptions);
  const { bluetooth, device } = makeFakeBluetooth(sim, fakeOptions);
  const transport = new BleTransport(bluetooth);
  const support = evaluateSupport({ nav: { userAgent: 'Chrome/141', bluetooth }, secureContext: true, protocol: 'http:', hostname: 'localhost' });
  const session = new SessionController({ transport, support });
  return { sim, bluetooth, device, transport, session };
}

describe('SessionController (Mock BLE)', () => {
  it('页面初始化时不发送任何数据', async () => {
    const { device } = setup();
    await flushAsync();
    expect(device.rx.writes).toHaveLength(0);
  });

  it('连接 → 识别协议 → 自动只读读取芯片信息与 Profile', async () => {
    const { session, sim, bluetooth } = setup();
    await session.connect();
    const s = session.getSnapshot();
    expect((bluetooth.lastOptions as { filters?: unknown[] } | null)?.filters?.[0]).toEqual({ name: 'eSIM_Writer' });
    expect(bluetooth.lastOptions?.optionalServices).toContain(NUS_SERVICE_UUID);
    expect(s.transport.state).toBe('connected');
    expect(s.transport.gatt?.rx.write).toBe(true);
    expect(s.transport.gatt?.tx.notify).toBe(true);
    expect(s.protocol).toMatchObject({ active: 'legacy-elpa', status: 'identified' });
    expect(s.device.info?.software).toBe('2.2.1');
    expect(s.device.wifi?.hasPassword).toBe(true);
    expect(JSON.stringify(s)).not.toContain(sim.password);
    expect(s.card.inserted).toBe(true);
    expect(s.card.chip?.eid).toBe(sim.eid);
    expect(s.card.chip?.euiccInfo2?.extCardResource?.freeNonVolatileMemory).toBe(291666);
    expect(s.card.profiles).toHaveLength(2);
    expect(s.card.profiles?.[0]?.nickname).toBe('主号');
    // 自动阶段只发送了只读命令
    expect(sim.handled).toEqual(['{"cmd":"getElpaInfo"}', 'lpac chip info', 'lpac profile list']);
  });

  it('日志中不出现 Wi-Fi 密码或完整 EID', async () => {
    const { session, sim } = setup();
    await session.connect();
    const text = session.logger.exportText({ app: 'test' });
    expect(text).not.toContain(sim.password);
    expect(text).not.toContain(sim.eid);
    expect(text).not.toContain('8944476500001234567');
  });

  it('未插卡时显示未插卡状态', async () => {
    const { session } = setup({ cardInserted: false });
    await session.connect();
    const s = session.getSnapshot();
    expect(s.card.inserted).toBe(false);
    expect(s.card.chip).toBeNull();
    expect(s.errors.at(-1)?.name).toBe('CardNotInsertedError');
  });

  it('关闭自动读取时只识别协议', async () => {
    const { session, sim } = setup();
    session.setSettings({ autoReadCard: false });
    await session.connect();
    expect(sim.handled).toEqual(['{"cmd":"getElpaInfo"}']);
  });

  it('设备不回复 getElpaInfo → 未识别，不会自动尝试 APDU 协议', async () => {
    const { session, sim } = setup();
    // 让固件忽略所有 JSON：模拟一个不认识 getElpaInfo 的固件
    const original = sim.write.bind(sim);
    sim.write = () => undefined;
    const p = session.connect();
    // identify 的超时为 6 秒，这里直接中止
    await flushAsync();
    await session.disconnect();
    await p;
    sim.write = original;
    expect(session.getSnapshot().protocol.active).toBeNull();
    expect(sim.handled).toEqual([]);
  });

  it('启用 / 停用 / 改名 / 删除，之后自动刷新列表', async () => {
    const { session, sim } = setup();
    await session.connect();
    await session.disableProfile('8944476500001234567');
    expect(session.getSnapshot().card.profiles?.every((p) => p.state === 'disabled')).toBe(true);
    await session.enableProfile('8986012345678901234');
    expect(session.getSnapshot().card.profiles?.find((p) => p.iccid === '8986012345678901234')?.state).toBe('enabled');
    await session.setNickname('8944476500001234567', '备用');
    expect(session.getSnapshot().card.profiles?.find((p) => p.iccid === '8944476500001234567')?.nickname).toBe('备用');
    await session.deleteProfile('8944476500001234567');
    expect(session.getSnapshot().card.profiles).toHaveLength(1);
    expect(sim.handled).toContain('lpac profile delete 8944476500001234567');
  });

  it('删除已启用的 Profile 被固件拒绝，错误可读', async () => {
    const { session } = setup();
    await session.connect();
    const err = await session.deleteProfile('8944476500001234567').catch((e) => e);
    expect(err).toBeInstanceOf(LpacError);
    expect(session.getSnapshot().card.profiles).toHaveLength(2);
  });

  it('下载：进度、成功后刷新 Profile 与通知', async () => {
    const { session, sim } = setup();
    await session.connect();
    const stages: string[] = [];
    const unsub = session.subscribe(() => {
      const p = session.getSnapshot().operation?.progress;
      if (p && stages.at(-1) !== p.stage) stages.push(p.stage);
    });
    await session.downloadProfile({ activationCode: 'LPA:1$rsp.example.com$MATCH-1' });
    unsub();
    expect(stages[0]).toBe('es10b_get_euicc_challenge_and_info');
    expect(stages.at(-1)).toBe('es10b_load_bound_profile_package');
    expect(sim.handled).toContain('lpac profile download -s rsp.example.com -m MATCH-1');
    expect(session.getSnapshot().card.profiles).toHaveLength(3);
    expect(session.getSnapshot().card.notifications?.[0]?.operation).toBe('install');
    // 激活码内容不进日志
    expect(session.logger.exportText({})).not.toContain('MATCH-1');
  });

  it('下载失败时报告失败的阶段', async () => {
    const { session } = setup({ downloadFailsAt: 'es9p_authenticate_client' });
    await session.connect();
    const err = await session.downloadProfile({ activationCode: 'LPA:1$rsp.example.com$M' }).catch((e) => e);
    expect(err).toBeInstanceOf(LpacError);
    expect((err as LpacError).functionName).toBe('es9p_authenticate_client');
  });

  it('写入 eUICC 失败（unknown,unknown）：解释原因，并只读核对 Profile 与通知', async () => {
    const { session, sim } = setup({ downloadFailsAt: 'es10b_load_bound_profile_package' });
    await session.connect();
    const before = sim.handled.length;
    const err = await session.downloadProfile({ activationCode: 'LPA:1$rsp.example.com$M' }).catch((e) => e);
    expect(err).toBeInstanceOf(LpacError);
    expect((err as Error).message).toContain('没有拿到卡片返回的安装结果');
    expect(sim.handled.slice(before)).toEqual(['lpac profile download -s rsp.example.com -m M', 'lpac profile list', 'lpac notification list']);
    const report = session.getSnapshot().lastDownload;
    expect(report).toMatchObject({ ok: false, failedStage: 'es10b_load_bound_profile_package', newProfiles: [], notificationsAfter: [] });
  });

  it('报告失败但卡上其实装上了：事后核对能发现新 Profile', async () => {
    const { session } = setup({ downloadFailsAt: 'es10b_load_bound_profile_package', installDespiteError: true });
    await session.connect();
    await session.downloadProfile({ activationCode: 'LPA:1$rsp.example.com$M' }).catch(() => undefined);
    const report = session.getSnapshot().lastDownload;
    expect(report?.newProfiles.map((p) => p.iccid)).toEqual(['8988247000123456789']);
    expect(report?.notificationsAfter?.[0]?.operation).toBe('install');
  });

  it('SM-DP+ 阶段失败不读取通知（卡片尚未写入）', async () => {
    const { session, sim } = setup({ downloadFailsAt: 'es9p_authenticate_client' });
    await session.connect();
    const before = sim.handled.length;
    await session.downloadProfile({ activationCode: 'LPA:1$rsp.example.com$M' }).catch(() => undefined);
    expect(sim.handled.slice(before)).toEqual(['lpac profile download -s rsp.example.com -m M', 'lpac profile list']);
  });

  it('处理并移除全部通知', async () => {
    const { session } = setup({ notifications: [{ seqNumber: 1, profileManagementOperation: 'install', notificationAddress: 'a.com', iccid: '8986012345678901234' }] });
    await session.connect();
    await session.readNotifications();
    expect(session.getSnapshot().card.notifications).toHaveLength(1);
    await session.processAllNotifications(true);
    expect(session.getSnapshot().card.notifications).toHaveLength(0);
  });

  it('设置 Wi-Fi 后读取状态确认（固件不回复 setWifiInfo）', async () => {
    const { session, sim } = setup({ wifiConnected: false });
    await session.connect();
    const p = session.setWifi('Office', 'new-pass');
    const wifi = await p;
    expect(wifi.connected).toBe(true);
    expect(wifi.ssid).toBe('Office');
    expect(sim.password).toBe('new-pass');
    expect(session.logger.exportText({})).not.toContain('new-pass');
  }, 20000);

  it('同一时间只允许一个操作', async () => {
    const { session } = setup();
    await session.connect();
    const p = session.readProfiles();
    await expect(session.readChipInfo()).rejects.toThrow(/正在执行/);
    await p;
  });

  it('意外断开：中止在途写操作并标记结果未知，界面状态复位', async () => {
    const { session, device, sim } = setup();
    await session.connect();
    sim.write = () => undefined; // 设备收到命令后“失联”
    const p = session.deleteProfile('8986012345678901234').catch((e) => e);
    await flushAsync();
    device.simulateLinkLoss();
    const err = await p;
    expect(err.name).toBe('DisconnectedError');
    const s = session.getSnapshot();
    expect(s.transport.state).toBe('disconnected');
    expect(s.interrupted?.label).toBe('删除 Profile');
    expect(s.card.profiles).toBeNull();
    expect(s.device.info).toBeNull();
    expect(s.operation).toBeNull();
  });

  it('重新连接后恢复（不自动重试写操作）', async () => {
    const { session, device, sim } = setup();
    await session.connect();
    device.simulateLinkLoss();
    await flushAsync();
    const before = sim.handled.length;
    await session.reconnect();
    expect(session.getSnapshot().transport.state).toBe('connected');
    expect(sim.handled.slice(before)).toEqual(['{"cmd":"getElpaInfo"}', 'lpac chip info', 'lpac profile list']);
  });

  it('设备没有 NUS 服务时给出明确错误', async () => {
    const { session } = setup({}, { withService: false });
    await expect(session.connect()).rejects.toThrow(/UART 服务/);
    expect(session.getSnapshot().transport.state).toBe('disconnected');
  });

  it('用户取消设备选择不算错误', async () => {
    const { session, bluetooth } = setup();
    bluetooth.cancel = true;
    await session.connect();
    expect(session.getSnapshot().errors).toHaveLength(0);
    expect(session.getSnapshot().transport.state).toBe('idle');
  });

  it('MTU 过小导致通知被截断时能检测到，而不是卡死', async () => {
    const { session } = setup({ mtu: 185 });
    session.setSettings({ autoReadCard: false });
    await session.connect().catch(() => undefined);
    // getElpaInfo 的回复超过 182 字节，会被截断
    const s = session.getSnapshot();
    expect(s.stats.maxChunk).toBe(182);
    expect(s.protocol.status).toBe('unidentified');
  }, 15000);

  it('未插卡后读取芯片信息报告 CardNotInsertedError', async () => {
    const { session, sim } = setup();
    await session.connect();
    sim.cardInserted = false;
    await expect(session.readChipInfo()).rejects.toBeInstanceOf(CardNotInsertedError);
    expect(session.getSnapshot().card.inserted).toBe(false);
  });

  it('诊断控制台只执行白名单命令', async () => {
    const { session, sim } = setup();
    await session.connect();
    await session.runReadOnlyCommand('lpac version');
    expect(session.getSnapshot().device.lpacVersion).toBe('v2.0.0-9esim');
    await expect(session.runReadOnlyCommand('lpac chip purge yes')).rejects.toThrow(/已拒绝/);
    expect(sim.handled).not.toContain('lpac chip purge yes');
  });

  it('超长命令被拒绝且不会发出', async () => {
    const { session, device } = setup();
    await session.connect();
    const writes = device.rx.writes.length;
    await expect(session.setWifi('a'.repeat(32), 'b'.repeat(64) + '"'.repeat(0))).resolves.toBeDefined();
    const longSsid = 'é'.repeat(16); // 32 字节
    await expect(session.setWifi(longSsid, '中'.repeat(21))).resolves.toBeDefined();
    expect(device.rx.writes.length).toBeGreaterThan(writes);
    expect(device.rx.writes.every((w) => w.length <= 255)).toBe(true);
  }, 60000);
});
