import type { ChipInfo, ElpaInfo, EuiccInfo2, EuiccNotification, EuiccProfile, ProfileClass, ProfileState, WifiInfo } from './types';

/**
 * 把旧版 eLPA 固件（lpac JSON 输出）转换成业务类型。
 * 字段来源：src/app/applet/chip/info.c、profile/list.c、notification/list.c、
 * src/message_handler.cpp（get_elpa_info / get_wifi）。
 *
 * 注意：这里刻意 **不** 把 Wi-Fi 密码复制进任何结构，只保留“是否有密码”。
 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const s = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

function parseEuiccInfo2(v: unknown): EuiccInfo2 | null {
  if (!isObj(v)) return null;
  const ext = isObj(v.extCardResource) ? v.extCardResource : null;
  const cert = isObj(v.certificationDataObject) ? v.certificationDataObject : null;
  return {
    profileVersion: s(v.profileVersion),
    svn: s(v.svn),
    euiccFirmwareVer: s(v.euiccFirmwareVer),
    extCardResource: ext
      ? {
          installedApplication: n(ext.installedApplication),
          freeNonVolatileMemory: n(ext.freeNonVolatileMemory),
          freeVolatileMemory: n(ext.freeVolatileMemory),
        }
      : null,
    uiccCapability: strArr(v.uiccCapability),
    ts102241Version: s(v.ts102241Version),
    globalplatformVersion: s(v.globalplatformVersion),
    rspCapability: strArr(v.rspCapability),
    euiccCiPKIdListForVerification: strArr(v.euiccCiPKIdListForVerification),
    euiccCiPKIdListForSigning: strArr(v.euiccCiPKIdListForSigning),
    euiccCategory: s(v.euiccCategory),
    forbiddenProfilePolicyRules: strArr(v.forbiddenProfilePolicyRules),
    ppVersion: s(v.ppVersion),
    sasAcreditationNumber: s(v.sasAcreditationNumber),
    platformLabel: cert ? s(cert.platformLabel) : null,
    discoveryBaseURL: cert ? s(cert.discoveryBaseURL) : null,
  };
}

export function parseChipInfo(data: unknown): ChipInfo {
  if (!isObj(data)) throw new ParseError('chipInfo 数据不是对象');
  const addr = isObj(data.EuiccConfiguredAddresses) ? data.EuiccConfiguredAddresses : null;
  return {
    eid: s(data.eidValue),
    defaultDpAddress: addr ? s(addr.defaultDpAddress) : null,
    rootDsAddress: addr ? s(addr.rootDsAddress) : null,
    euiccInfo2: parseEuiccInfo2(data.EUICCInfo2),
    rulesAuthorisationTableCount: Array.isArray(data.rulesAuthorisationTable) ? data.rulesAuthorisationTable.length : null,
  };
}

const STATES: readonly ProfileState[] = ['enabled', 'disabled', 'unknown'];
const CLASSES: readonly ProfileClass[] = ['test', 'provisioning', 'operational', 'unknown'];

export function parseProfileList(data: unknown): EuiccProfile[] {
  if (!Array.isArray(data)) throw new ParseError('profileList 数据不是数组');
  return data.filter(isObj).map((p) => {
    const state = typeof p.profileState === 'string' && (STATES as string[]).includes(p.profileState) ? (p.profileState as ProfileState) : 'unknown';
    const cls = typeof p.profileClass === 'string' && (CLASSES as string[]).includes(p.profileClass) ? (p.profileClass as ProfileClass) : 'unknown';
    const iconType = p.iconType === 'png' || p.iconType === 'jpeg' ? p.iconType : p.iconType ? 'unknown' : null;
    const icon = s(p.icon);
    return {
      iccid: s(p.iccid) ?? '',
      isdpAid: s(p.isdpAid),
      state,
      nickname: s(p.profileNickname),
      serviceProviderName: s(p.serviceProviderName),
      profileName: s(p.profileName),
      iconType,
      icon: icon && /^[A-Za-z0-9+/=\s]+$/.test(icon) ? icon.replace(/\s+/g, '') : null,
      profileClass: cls,
    } satisfies EuiccProfile;
  });
}

export function parseNotificationList(data: unknown): EuiccNotification[] {
  if (!Array.isArray(data)) throw new ParseError('notificationList 数据不是数组');
  return data.filter(isObj).map((x) => ({
    seqNumber: n(x.seqNumber) ?? -1,
    operation: s(x.profileManagementOperation) ?? 'unknown',
    address: s(x.notificationAddress),
    iccid: s(x.iccid),
  }));
}

export function parseWifiInfo(data: Obj): WifiInfo {
  return {
    ssid: typeof data.ssid === 'string' ? data.ssid : '',
    hasPassword: typeof data.password === 'string' && data.password.length > 0,
    connected: data.connected === true,
    rssi: n(data.rssi),
    deviceTime: s(data.time),
  };
}

export function parseElpaInfo(data: Obj): ElpaInfo {
  return {
    hardware: s(data.hardware),
    firmware: s(data.firmware),
    software: s(data.software),
    hasNewSoftware: data.hasNewSoftware === true,
    newSoftwareVersion: s(data.newSoftwareVersion),
    mac: s(data.mac),
    wifi: parseWifiInfo(data),
  };
}

/** 选出当前启用的 Profile。 */
export function enabledProfile(profiles: readonly EuiccProfile[] | null | undefined): EuiccProfile | null {
  return profiles?.find((p) => p.state === 'enabled') ?? null;
}
