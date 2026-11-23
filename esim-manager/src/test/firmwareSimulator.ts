/**
 * 测试专用：按 9eSIM eLPA 固件源码（V2.2.1，github.com/9esim/eLPA @ e0bd5dc）
 * 行为编写的模拟器。**只用于自动化测试，不代表真实硬件验证。**
 *
 * 复刻的关键行为：
 * - onWrite → 按 256 字节切包，每包单独交给 message_handler（ble_sim_uart_tt.cpp）；
 * - message_handler：JSON → cmd 分发；非 JSON → 未插卡回 cardStatus，否则按空格切分交给 lpac main；
 * - applet_entry：argv[0] 是程序名，从 argv[1] 开始匹配，未知命令只打印到串口（蓝牙无回复）；
 * - 回复按 256 字节（或 MTU-3，模拟截断）分段 notify；
 * - getElpaInfo / cardStatus 用 cJSON_Print 风格（换行 + 制表符），lpa / progress 无空白。
 */

export interface SimProfile {
  iccid: string;
  isdpAid: string;
  profileState: 'enabled' | 'disabled';
  profileNickname: string | null;
  serviceProviderName: string | null;
  profileName: string | null;
  iconType: string | null;
  icon: string | null;
  profileClass: 'test' | 'provisioning' | 'operational';
}

export interface SimOptions {
  cardInserted?: boolean;
  /** 模拟 BLE MTU；通知负载为 min(256, mtu-3)，超出部分被截断丢弃（Bluedroid 行为）。 */
  mtu?: number;
  profiles?: SimProfile[];
  eid?: string;
  ssid?: string;
  password?: string;
  wifiConnected?: boolean;
  /** 让 euicc_init 失败（模拟卡片接触不良）。 */
  euiccInitFails?: boolean;
  /** download 在哪一步失败（函数名）。 */
  downloadFailsAt?: string | null;
  /** 在 load_bound_profile_package 报错的同时卡上其实已经装好了（用于测试事后核对）。 */
  installDespiteError?: boolean;
  notifications?: Array<{ seqNumber: number; profileManagementOperation: string; notificationAddress: string; iccid: string }>;
}

/** cJSON_Print 的格式（2 级以内足够） */
export function cjsonPrint(obj: Record<string, unknown>, indent = 1): string {
  const tabs = '\t'.repeat(indent);
  const entries = Object.entries(obj).map(([k, v]) => {
    const val = typeof v === 'object' && v !== null && !Array.isArray(v) ? cjsonPrint(v as Record<string, unknown>, indent + 1) : JSON.stringify(v);
    return `${tabs}${JSON.stringify(k)}:\t${val}`;
  });
  return `{\n${entries.join(',\n')}\n${'\t'.repeat(indent - 1)}}`;
}

export class FirmwareSimulator {
  cardInserted: boolean;
  mtu: number;
  profiles: SimProfile[];
  eid: string;
  ssid: string;
  password: string;
  wifiConnected: boolean;
  euiccInitFails: boolean;
  downloadFailsAt: string | null;
  installDespiteError: boolean;
  notifications: NonNullable<SimOptions['notifications']>;
  /** 每个被 message_handler 处理过的“包”（用于断言固件真正看到了什么）。 */
  readonly handled: string[] = [];
  /** 发往浏览器的每次 notify 负载。 */
  readonly notified: Uint8Array[] = [];
  private sink: ((chunk: Uint8Array) => void) | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: SimOptions = {}) {
    this.cardInserted = options.cardInserted ?? true;
    this.mtu = options.mtu ?? 517;
    this.eid = options.eid ?? '89049032123451234512345678901235';
    this.ssid = options.ssid ?? 'HomeWiFi';
    this.password = options.password ?? 'super-secret-pw';
    this.wifiConnected = options.wifiConnected ?? true;
    this.euiccInitFails = options.euiccInitFails ?? false;
    this.downloadFailsAt = options.downloadFailsAt ?? null;
    this.installDespiteError = options.installDespiteError ?? false;
    this.notifications = options.notifications ?? [];
    this.profiles = options.profiles ?? [
      {
        iccid: '8944476500001234567',
        isdpAid: 'A0000005591010FFFFFFFF8900001000',
        profileState: 'enabled',
        profileNickname: '主号',
        serviceProviderName: 'Example Mobile',
        profileName: 'Example 5G',
        iconType: null,
        icon: null,
        profileClass: 'operational',
      },
      {
        iccid: '8986012345678901234',
        isdpAid: 'A0000005591010FFFFFFFF8900001100',
        profileState: 'disabled',
        profileNickname: null,
        serviceProviderName: 'Travel SIM',
        profileName: 'Travel {Data} "EU"',
        iconType: 'png',
        icon: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        profileClass: 'operational',
      },
    ];
  }

  attach(sink: (chunk: Uint8Array) => void) {
    this.sink = sink;
  }

  detach() {
    this.sink = null;
  }

  /** 模拟 BLE 写入：onWrite → ble_recv_data（256 字节切包） → 队列 → message_handler。 */
  write(value: Uint8Array) {
    for (let off = 0; off < value.length; off += 256) {
      const pack = value.subarray(off, Math.min(off + 256, value.length));
      const text = new TextDecoder().decode(pack);
      this.queue = this.queue.then(() => this.messageHandler(text));
    }
  }

  /** 等所有已排队命令处理完。 */
  idle(): Promise<void> {
    return this.queue;
  }

  private send(text: string) {
    const bytes = new TextEncoder().encode(text);
    const payloadMax = Math.min(256, this.mtu - 3);
    for (let off = 0; off < bytes.length; off += 256) {
      // 固件按 256 切段；协议栈把每段截断到 MTU-3
      const chunk = bytes.slice(off, Math.min(off + 256, bytes.length)).slice(0, payloadMax);
      this.notified.push(chunk);
      this.sink?.(chunk);
    }
  }

  private lpa(code: number, message: string, dataType: string | null, data: unknown) {
    const payload: Record<string, unknown> = { code, message };
    if (code === 0) {
      payload.dataType = dataType;
      payload.data = data ?? null;
    } else {
      payload.data = data ?? '';
    }
    this.send(JSON.stringify({ type: 'lpa', payload }));
  }

  private error(fn: string, detail = '') {
    this.lpa(-1, fn, null, detail);
  }

  private progress(fn: string, detail: string | null, step?: number, total?: number) {
    const payload: Record<string, unknown> = { code: 0, message: fn, data: detail };
    if (step !== undefined) {
      payload.step = step;
      payload.total_steps = total;
    }
    this.send(JSON.stringify({ type: 'progress', payload }));
  }

  private async messageHandler(message: string): Promise<void> {
    this.handled.push(message);
    let root: unknown;
    try {
      root = JSON.parse(message);
    } catch {
      root = null;
    }
    if (root === null || typeof root !== 'object') {
      if (!this.cardInserted) {
        this.send(cjsonPrint({ cmd: 'cardStatus', cardInserted: false }));
        return;
      }
      this.cli(message);
      return;
    }
    const cmd = (root as Record<string, unknown>).cmd;
    if (typeof cmd !== 'string') return;
    const r = root as Record<string, string>;
    switch (cmd) {
      case 'getElpaInfo':
        this.send(
          cjsonPrint({
            cmd: 'getElpaInfo',
            data: {
              ssid: this.ssid,
              password: this.password,
              connected: this.wifiConnected,
              rssi: -52,
              time: '2026-11-23 10:00:00',
              hardware: '2.0.0',
              firmware: '2.0.0',
              software: '2.2.1',
              hasNewSoftware: false,
              newSoftwareVersion: '',
              mac: '3485188a1b2c',
            },
          }),
        );
        return;
      case 'getWifiInfo':
        this.send(cjsonPrint({ cmd: 'getWifiInfo', data: { ssid: this.ssid, password: this.password, connected: this.wifiConnected, rssi: -52, time: '2026-11-23 10:00:00' } }));
        return;
      case 'setWifiInfo':
        this.ssid = r.ssid ?? '';
        this.password = r.password ?? '';
        this.wifiConnected = true;
        return; // 固件不回复
      default:
        return; // 未知 cmd：无回复
    }
  }

  private cli(message: string) {
    const argv = message.split(' ').filter((t) => t.length > 0); // strtok(" ")
    if (argv.length < 2) return; // applet_usage → printf
    const [, applet, sub, ...rest] = argv;
    switch (applet) {
      case 'version':
        this.lpa(0, 'success', 'version', 'v2.0.0-9esim');
        return;
      case 'chip':
        if (!this.initEuicc()) {
          if (sub === 'info') this.error('es10c_get_eid');
          return;
        }
        if (sub === 'info') {
          this.lpa(0, 'success', 'chipInfo', {
            eidValue: this.eid,
            EuiccConfiguredAddresses: { defaultDpAddress: null, rootDsAddress: 'lpa.ds.gsma.com' },
            EUICCInfo2: {
              profileVersion: '2.1.0',
              svn: '2.2.0',
              euiccFirmwareVer: '4.6.0',
              extCardResource: { installedApplication: 2, freeNonVolatileMemory: 291666, freeVolatileMemory: 12000 },
              uiccCapability: ['usimSupport', 'isimSupport', 'csimSupport'],
              ts102241Version: '9.2.0',
              globalplatformVersion: '2.3.0',
              rspCapability: ['additionalProfile', 'testProfileSupport'],
              euiccCiPKIdListForVerification: ['81370f5125d0b1d408d4c3b232e6d25e795bebfb'],
              euiccCiPKIdListForSigning: ['81370f5125d0b1d408d4c3b232e6d25e795bebfb'],
              euiccCategory: 'other',
              forbiddenProfilePolicyRules: ['pprUpdateControl', 'ppr1'],
              ppVersion: '0.0.1',
              sasAcreditationNumber: 'GI-BA-UP-0419',
              certificationDataObject: { platformLabel: '1.2.840.1234567/myPlatformLabel', discoveryBaseURL: 'https://myDiscoveryBaseURL.example.com' },
            },
            rulesAuthorisationTable: [{ pprIds: ['ppr1'], allowedOperators: [{ plmn: 'FFFFFF', gid1: null, gid2: null }], pprFlags: [] }],
          });
        }
        return;
      case 'profile':
        if (!this.initEuicc()) {
          if (sub === 'list') this.error('es10c_get_profiles_info');
          return;
        }
        this.profileCmd(sub, rest);
        return;
      case 'notification':
        if (!this.initEuicc()) return;
        this.notificationCmd(sub, rest);
        return;
      default:
        return; // Unknown command → 只打印到串口
    }
  }

  private initEuicc(): boolean {
    if (this.euiccInitFails) {
      this.error('euicc_init');
      return false;
    }
    return true;
  }

  private find(id: string | undefined) {
    return this.profiles.find((p) => p.iccid === id || p.isdpAid === id);
  }

  private profileCmd(sub: string | undefined, args: string[]) {
    switch (sub) {
      case 'list':
        this.lpa(0, 'success', 'profileList', this.profiles);
        return;
      case 'enable': {
        if (!args[0]) return;
        const p = this.find(args[0]);
        if (!p) return this.error('es10c_enable_profile', 'iccid or aid not found');
        if (p.profileState !== 'disabled') return this.error('es10c_enable_profile', 'profile not in disabled state');
        this.profiles.forEach((x) => (x.profileState = 'disabled'));
        p.profileState = 'enabled';
        this.notifications.push({ seqNumber: this.notifications.length + 1, profileManagementOperation: 'enable', notificationAddress: 'smdp.example.com', iccid: p.iccid });
        return this.lpa(0, 'success', 'enableProfile', null);
      }
      case 'disable': {
        if (!args[0]) return;
        const p = this.find(args[0]);
        if (!p) return this.error('es10c_disable_profile', 'iccid or aid not found');
        if (p.profileState !== 'enabled') return this.error('es10c_disable_profile', 'profile not in enabled state');
        p.profileState = 'disabled';
        return this.lpa(0, 'success', 'disableProfile', null);
      }
      case 'delete': {
        if (!args[0]) return;
        const p = this.find(args[0]);
        if (!p) return this.error('es10c_delete_profile', 'iccid or aid not found');
        if (p.profileState !== 'disabled') return this.error('es10c_delete_profile', 'profile not in disabled state');
        this.profiles = this.profiles.filter((x) => x !== p);
        return this.lpa(0, 'success', 'deleteProfile', null);
      }
      case 'nickname': {
        if (!args[0]) return;
        const p = this.find(args[0]);
        if (!p) return this.error('es10c_set_nickname', 'iccid not found');
        p.profileNickname = args[1] ?? '';
        return this.lpa(0, 'success', 'setNickname', null);
      }
      case 'download':
        return this.download(args);
      default:
        return;
    }
  }

  private download(argv: string[]) {
    let smdp: string | null = null;
    let matchingId: string | null = null;
    for (let i = 0; i < argv.length; i++) {
      if (argv[i]!.startsWith('-s')) smdp = argv[i + 1] ?? null;
      else if (argv[i]!.startsWith('-m')) matchingId = argv[i + 1] ?? null;
    }
    const steps = [
      'es10b_get_euicc_challenge_and_info',
      'es9p_initiate_authentication',
      'es10b_authenticate_server',
      'es9p_authenticate_client',
      'es10b_prepare_download',
      'es9p_get_bound_profile_package',
      'es10b_load_bound_profile_package',
    ];
    if (!smdp) return this.error('smdp is null');
    let step = 1;
    for (const fn of steps) {
      this.progress(fn, smdp, step++, 9);
      if (this.downloadFailsAt === fn) {
        if (fn === 'es10b_load_bound_profile_package' && this.installDespiteError) this.installNew(matchingId);
        // download.c：load 失败时细节为 "<bppCommandId>,<errorReason>"
        return this.error(fn, fn.startsWith('es9p') ? 'http status 500' : fn === 'es10b_load_bound_profile_package' ? 'unknown,unknown' : '');
      }
    }
    this.installNew(matchingId);
    this.lpa(0, 'success', 'downloadProfile', null);
  }

  private installNew(matchingId: string | null) {
    const smdp = 'rsp.example.com';
    this.profiles.push({
      iccid: '8988247000123456789',
      isdpAid: 'A0000005591010FFFFFFFF8900001200',
      profileState: 'disabled',
      profileNickname: null,
      serviceProviderName: 'New Carrier',
      profileName: matchingId ? 'New Plan' : 'Default Plan',
      iconType: null,
      icon: null,
      profileClass: 'operational',
    });
    this.notifications.push({ seqNumber: this.notifications.length + 1, profileManagementOperation: 'install', notificationAddress: smdp, iccid: '8988247000123456789' });
  }

  private notificationCmd(sub: string | undefined, args: string[]) {
    switch (sub) {
      case 'list':
        return this.lpa(0, 'success', 'notificationList', this.notifications);
      case 'process':
        if (args.includes('-a')) {
          this.progress('es10b_list_notification', null);
          for (const n of [...this.notifications]) {
            this.progress('es10b_retrieve_notifications_list', String(n.seqNumber));
            this.progress('es9p_handle_notification', String(n.seqNumber));
            if (args.includes('-r')) {
              this.progress('es10b_remove_notification_from_list', String(n.seqNumber));
              this.notifications = this.notifications.filter((x) => x !== n);
            }
          }
        }
        // 固件缺陷：不带 -a 时什么也不做，仍然报告成功
        return this.lpa(0, 'success', 'notificationProcess', null);
      case 'remove':
        if (args.includes('-a')) {
          this.progress('es10b_list_notification', null);
          for (const n of [...this.notifications]) this.progress('es10b_remove_notification_from_list', String(n.seqNumber));
          this.notifications = [];
        }
        return this.lpa(0, 'success', 'notificationRemove', null);
      default:
        return;
    }
  }
}
