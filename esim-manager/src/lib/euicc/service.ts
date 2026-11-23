import { ApduJsonAdapter } from '@/lib/protocol/apdu/ApduJsonAdapter';
import { UnsupportedOperationError } from '@/lib/protocol/errors';
import { LEGACY_COMMANDS, commandBuilders } from '@/lib/protocol/legacy/commands';
import { LegacyElpaAdapter } from '@/lib/protocol/legacy/LegacyElpaAdapter';
import type { ProgressMessage } from '@/lib/protocol/messages';
import { DOWNLOAD_STAGES, parseActivationCode, validateConfirmationCode } from './activationCode';
import { parseChipInfo, parseElpaInfo, parseNotificationList, parseProfileList, parseWifiInfo } from './parse';
import type { ChipInfo, DownloadProgress, ElpaInfo, EuiccNotification, EuiccProfile, WifiInfo } from './types';

/**
 * 统一业务接口。底层命令全部来自对应固件源码，见 protocol/legacy/commands.ts。
 * 未被某协议支持的操作抛出 UnsupportedOperationError，而不是伪造结果。
 */
export interface EuiccCapabilities {
  deviceInfo: boolean;
  wifi: boolean;
  chipInfo: boolean;
  listProfiles: boolean;
  enable: boolean;
  disable: boolean;
  delete: boolean;
  nickname: boolean;
  download: boolean;
  notifications: boolean;
  discovery: boolean;
}

export interface DownloadRequest {
  activationCode: string;
  confirmationCode?: string | null;
}

export interface OperationHooks {
  onProgress?: (progress: DownloadProgress) => void;
}

export interface EuiccService {
  readonly protocol: 'legacy-elpa' | 'apdu-json';
  readonly capabilities: EuiccCapabilities;
  getDeviceInfo(): Promise<ElpaInfo>;
  getWifiInfo(): Promise<WifiInfo>;
  setWifi(ssid: string, password: string): Promise<void>;
  getLpacVersion(): Promise<string>;
  getChipInfo(): Promise<ChipInfo>;
  listProfiles(): Promise<EuiccProfile[]>;
  enableProfile(iccid: string): Promise<void>;
  disableProfile(iccid: string): Promise<void>;
  deleteProfile(iccid: string): Promise<void>;
  setNickname(iccid: string, nickname: string): Promise<void>;
  downloadProfile(request: DownloadRequest, hooks?: OperationHooks): Promise<void>;
  listNotifications(): Promise<EuiccNotification[]>;
  processAllNotifications(remove: boolean, hooks?: OperationHooks): Promise<void>;
  removeAllNotifications(hooks?: OperationHooks): Promise<void>;
  discoverProfiles(hooks?: OperationHooks): Promise<string[]>;
  abortAll(error?: Error): void;
}

export function toDownloadProgress(p: ProgressMessage): DownloadProgress {
  return {
    step: p.step,
    totalSteps: p.totalSteps,
    stage: p.message,
    label: DOWNLOAD_STAGES[p.message] ?? p.message,
    detail: typeof p.data === 'string' && p.data ? p.data : null,
  };
}

export class LegacyEuiccService implements EuiccService {
  readonly protocol = 'legacy-elpa' as const;
  readonly capabilities: EuiccCapabilities = {
    deviceInfo: true,
    wifi: true,
    chipInfo: true,
    listProfiles: true,
    enable: true,
    disable: true,
    delete: true,
    nickname: true,
    download: true,
    notifications: true,
    discovery: true,
  };

  constructor(readonly adapter: LegacyElpaAdapter) {}

  async getDeviceInfo(): Promise<ElpaInfo> {
    const m = await this.adapter.requestJson(LEGACY_COMMANDS.getElpaInfo, commandBuilders.getElpaInfo());
    return parseElpaInfo(m.data);
  }

  async getWifiInfo(): Promise<WifiInfo> {
    const m = await this.adapter.requestJson(LEGACY_COMMANDS.getWifiInfo, commandBuilders.getWifiInfo());
    return parseWifiInfo(m.data);
  }

  /** 固件对 setWifiInfo 不回复，调用方需要随后读取 Wi-Fi 状态确认。 */
  async setWifi(ssid: string, password: string): Promise<void> {
    await this.adapter.sendWithoutReply(LEGACY_COMMANDS.setWifiInfo, commandBuilders.setWifiInfo(ssid, password));
  }

  async getLpacVersion(): Promise<string> {
    const r = await this.adapter.requestCli(LEGACY_COMMANDS.version, commandBuilders.version());
    return typeof r.data === 'string' ? r.data : String(r.data);
  }

  async getChipInfo(): Promise<ChipInfo> {
    const r = await this.adapter.requestCli(LEGACY_COMMANDS.chipInfo, commandBuilders.chipInfo());
    return parseChipInfo(r.data);
  }

  async listProfiles(): Promise<EuiccProfile[]> {
    const r = await this.adapter.requestCli(LEGACY_COMMANDS.profileList, commandBuilders.profileList());
    return parseProfileList(r.data);
  }

  async enableProfile(iccid: string): Promise<void> {
    await this.adapter.requestCli(LEGACY_COMMANDS.enableProfile, commandBuilders.enableProfile(iccid));
  }

  async disableProfile(iccid: string): Promise<void> {
    await this.adapter.requestCli(LEGACY_COMMANDS.disableProfile, commandBuilders.disableProfile(iccid));
  }

  async deleteProfile(iccid: string): Promise<void> {
    await this.adapter.requestCli(LEGACY_COMMANDS.deleteProfile, commandBuilders.deleteProfile(iccid));
  }

  async setNickname(iccid: string, nickname: string): Promise<void> {
    await this.adapter.requestCli(LEGACY_COMMANDS.setNickname, commandBuilders.setNickname(iccid, nickname));
  }

  async downloadProfile(request: DownloadRequest, hooks: OperationHooks = {}): Promise<void> {
    const ac = parseActivationCode(request.activationCode);
    const confirmationCode = ac.confirmationCodeRequired || request.confirmationCode ? validateConfirmationCode(request.confirmationCode ?? '') : null;
    const text = commandBuilders.downloadProfile({ smdp: ac.smdp, matchingId: ac.matchingId, confirmationCode });
    await this.adapter.requestCli(LEGACY_COMMANDS.downloadProfile, text, {
      onProgress: (p) => hooks.onProgress?.(toDownloadProgress(p)),
    });
  }

  async listNotifications(): Promise<EuiccNotification[]> {
    const r = await this.adapter.requestCli(LEGACY_COMMANDS.notificationList, commandBuilders.notificationList());
    return parseNotificationList(r.data);
  }

  async processAllNotifications(remove: boolean, hooks: OperationHooks = {}): Promise<void> {
    await this.adapter.requestCli(LEGACY_COMMANDS.notificationProcessAll, commandBuilders.notificationProcessAll(remove), {
      onProgress: (p) => hooks.onProgress?.(toDownloadProgress(p)),
    });
  }

  async removeAllNotifications(hooks: OperationHooks = {}): Promise<void> {
    await this.adapter.requestCli(LEGACY_COMMANDS.notificationRemoveAll, commandBuilders.notificationRemoveAll(), {
      onProgress: (p) => hooks.onProgress?.(toDownloadProgress(p)),
    });
  }

  async discoverProfiles(hooks: OperationHooks = {}): Promise<string[]> {
    const r = await this.adapter.requestCli(LEGACY_COMMANDS.discovery, commandBuilders.discovery(), {
      onProgress: (p) => hooks.onProgress?.(toDownloadProgress(p)),
    });
    return Array.isArray(r.data) ? r.data.filter((x): x is string => typeof x === 'string') : [];
  }

  abortAll(error?: Error): void {
    this.adapter.abortAll(error);
  }
}

const APDU_UNSUPPORTED = '该协议只实现了只读功能（待设备验证），写操作需要先在真实设备上验证协议。';
const APDU_NO_DOWNLOAD = '下载需要直接访问 SM-DP+ 的 ES9+ 接口，SM-DP+ 不允许浏览器跨域访问，必须由设备固件代理（旧版 eLPA 协议支持）。';

export class ApduEuiccService implements EuiccService {
  readonly protocol = 'apdu-json' as const;
  readonly capabilities: EuiccCapabilities = {
    deviceInfo: false,
    wifi: false,
    chipInfo: true,
    listProfiles: true,
    enable: false,
    disable: false,
    delete: false,
    nickname: false,
    download: false,
    notifications: false,
    discovery: false,
  };

  constructor(readonly adapter: ApduJsonAdapter) {}

  getDeviceInfo(): Promise<ElpaInfo> {
    return Promise.reject(new UnsupportedOperationError('读取读卡器信息', 'APDU JSON 协议没有对应命令。'));
  }
  getWifiInfo(): Promise<WifiInfo> {
    return Promise.reject(new UnsupportedOperationError('读取 Wi-Fi', 'APDU JSON 协议没有对应命令。'));
  }
  setWifi(): Promise<void> {
    return Promise.reject(new UnsupportedOperationError('设置 Wi-Fi', 'APDU JSON 协议没有对应命令。'));
  }
  getLpacVersion(): Promise<string> {
    return Promise.reject(new UnsupportedOperationError('lpac 版本', 'APDU JSON 固件不内置 lpac。'));
  }
  async getChipInfo(): Promise<ChipInfo> {
    const eid = await this.adapter.getEid();
    return { eid, defaultDpAddress: null, rootDsAddress: null, euiccInfo2: null, rulesAuthorisationTableCount: null };
  }
  listProfiles(): Promise<EuiccProfile[]> {
    return this.adapter.listProfiles();
  }
  enableProfile(): Promise<void> {
    return Promise.reject(new UnsupportedOperationError('启用 Profile', APDU_UNSUPPORTED));
  }
  disableProfile(): Promise<void> {
    return Promise.reject(new UnsupportedOperationError('停用 Profile', APDU_UNSUPPORTED));
  }
  deleteProfile(): Promise<void> {
    return Promise.reject(new UnsupportedOperationError('删除 Profile', APDU_UNSUPPORTED));
  }
  setNickname(): Promise<void> {
    return Promise.reject(new UnsupportedOperationError('修改昵称', APDU_UNSUPPORTED));
  }
  downloadProfile(): Promise<void> {
    return Promise.reject(new UnsupportedOperationError('下载 Profile', APDU_NO_DOWNLOAD));
  }
  listNotifications(): Promise<EuiccNotification[]> {
    return Promise.reject(new UnsupportedOperationError('通知列表', APDU_UNSUPPORTED));
  }
  processAllNotifications(): Promise<void> {
    return Promise.reject(new UnsupportedOperationError('发送通知', APDU_NO_DOWNLOAD));
  }
  removeAllNotifications(): Promise<void> {
    return Promise.reject(new UnsupportedOperationError('移除通知', APDU_UNSUPPORTED));
  }
  discoverProfiles(): Promise<string[]> {
    return Promise.reject(new UnsupportedOperationError('SM-DS 发现', APDU_NO_DOWNLOAD));
  }
  abortAll(error?: Error): void {
    this.adapter.abortAll(error);
  }
}
