/** 业务层类型。字段名与 lpac / eLPA 固件输出保持对应关系，便于核对。 */

export type ProfileState = 'enabled' | 'disabled' | 'unknown';
export type ProfileClass = 'test' | 'provisioning' | 'operational' | 'unknown';

export interface EuiccProfile {
  iccid: string;
  isdpAid: string | null;
  state: ProfileState;
  nickname: string | null;
  serviceProviderName: string | null;
  profileName: string | null;
  iconType: 'png' | 'jpeg' | 'unknown' | null;
  /** base64 编码的图标。 */
  icon: string | null;
  profileClass: ProfileClass;
}

export interface ExtCardResource {
  installedApplication: number | null;
  freeNonVolatileMemory: number | null;
  freeVolatileMemory: number | null;
}

export interface EuiccInfo2 {
  profileVersion: string | null;
  svn: string | null;
  euiccFirmwareVer: string | null;
  extCardResource: ExtCardResource | null;
  uiccCapability: string[];
  ts102241Version: string | null;
  globalplatformVersion: string | null;
  rspCapability: string[];
  euiccCiPKIdListForVerification: string[];
  euiccCiPKIdListForSigning: string[];
  euiccCategory: string | null;
  forbiddenProfilePolicyRules: string[];
  ppVersion: string | null;
  sasAcreditationNumber: string | null;
  platformLabel: string | null;
  discoveryBaseURL: string | null;
}

export interface ChipInfo {
  eid: string | null;
  defaultDpAddress: string | null;
  rootDsAddress: string | null;
  euiccInfo2: EuiccInfo2 | null;
  rulesAuthorisationTableCount: number | null;
}

export interface EuiccNotification {
  seqNumber: number;
  operation: string;
  address: string | null;
  iccid: string | null;
}

export interface WifiInfo {
  ssid: string;
  /** 只记录是否设置了密码，绝不保存密码本身。 */
  hasPassword: boolean;
  connected: boolean;
  rssi: number | null;
  deviceTime: string | null;
}

export interface ElpaInfo {
  hardware: string | null;
  firmware: string | null;
  software: string | null;
  hasNewSoftware: boolean;
  newSoftwareVersion: string | null;
  mac: string | null;
  wifi: WifiInfo;
}

export interface DownloadProgress {
  step: number | null;
  totalSteps: number | null;
  /** 固件报告的函数名。 */
  stage: string;
  /** 中文说明。 */
  label: string;
  detail: string | null;
}
