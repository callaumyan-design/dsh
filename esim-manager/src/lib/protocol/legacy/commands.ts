import { MAX_COMMAND_BYTES } from '@/lib/ble/constants';

/**
 * 旧版 eLPA 固件（9eSIM eLPA V2.x）命令构造与校验。
 *
 * 源码依据（github.com/9esim/eLPA @ e0bd5dc）：
 *
 * 1. src/message_handler.cpp: message_handler()
 *    - 先 cJSON_Parse。成功 → 取 "cmd" 字段，在
 *      {setWifiInfo, getWifiInfo, getElpaInfo, upgradeSoftware, checkUpdate} 中查找；
 *      不认识的 cmd **没有任何回复**。
 *    - 解析失败 → 视为 lpac CLI 文本。若未插卡（V2.2.1），回复
 *      {"cmd":"cardStatus","cardInserted":false}；否则 parse_command_into_cli()。
 *
 * 2. src/lpac_wrapper.cpp: parse_command_into_cli()
 *    - 只用 strtok(cmd, " ") 按 **空格** 切分，不支持引号/转义；
 *    - argv 数组固定 20 个元素，**没有越界检查**；
 *    - 然后调用 lpac 的 main(argc, argv)。
 *
 * 3. src/app/applet.c: applet_entry()
 *    - 与桌面版 lpac 一样，argv[0] 被当作程序名，**从 argv[1] 开始匹配 applet**。
 *    - 因此发送 "chip info" 会被解析成 程序名=chip、applet=info → "Unknown command"，
 *      而且这条错误只 printf 到串口，**蓝牙端收不到任何回复**。
 *    - 正确格式是 "lpac chip info"（第一个词可以是任意占位符，本应用固定用 lpac）。
 */

export const LPAC_PROGRAM_NAME = 'lpac';
/** parse_command_into_cli 的 argv[20]。 */
export const MAX_ARGV = 20;

export class CommandValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandValidationError';
  }
}

export function encodeCommand(text: string, maxBytes = MAX_COMMAND_BYTES): Uint8Array {
  if (text.length === 0) throw new CommandValidationError('命令为空。');
  if (/[\0\r\n]/.test(text)) throw new CommandValidationError('命令不能包含换行或 NUL 字符。');
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > maxBytes) {
    throw new CommandValidationError(
      `命令编码后为 ${bytes.length} 字节，超过固件单次接收上限 ${maxBytes} 字节。旧版固件会把超长写入按 256 字节拆成两条独立命令执行，因此已拒绝发送（不截断）。`,
    );
  }
  return bytes;
}

/** 校验单个 CLI 参数：固件只按空格切分，参数里不能有任何空白。 */
export function validateCliArg(arg: string, label = '参数'): string {
  if (arg.length === 0) throw new CommandValidationError(`${label}不能为空。`);
  if (/\s/.test(arg)) throw new CommandValidationError(`${label}不能包含空格或其他空白字符（固件仅按空格切分参数，不支持引号）。`);
  if (/[\0]/.test(arg)) throw new CommandValidationError(`${label}包含非法字符。`);
  return arg;
}

/** 构造 lpac CLI 文本：`lpac <applet> <sub> [args…]`。 */
export function buildLpacCommand(args: readonly string[]): string {
  if (args.length === 0) throw new CommandValidationError('缺少 lpac 子命令。');
  args.forEach((a, i) => validateCliArg(a, `第 ${i + 1} 个参数`));
  if (args.length + 1 > MAX_ARGV) throw new CommandValidationError(`参数过多（固件 argv 上限 ${MAX_ARGV}，且没有越界检查）。`);
  const text = [LPAC_PROGRAM_NAME, ...args].join(' ');
  encodeCommand(text);
  return text;
}

/** 构造 JSON 控制命令。 */
export function buildJsonCommand(cmd: string, fields: Record<string, string> = {}): string {
  const text = JSON.stringify({ cmd, ...fields });
  encodeCommand(text);
  return text;
}

// ---------------------------------------------------------------------------
// 命令规格表
// ---------------------------------------------------------------------------

export type LegacyCommandKind = 'json' | 'cli';

export interface LegacyCommandSpec {
  id: string;
  label: string;
  kind: LegacyCommandKind;
  /** 是否只读（不修改卡片、读卡器配置）。 */
  readOnly: boolean;
  /** JSON 命令：期望回复里的 cmd；null 表示固件不回复。 */
  responseCmd?: 'getElpaInfo' | 'getWifiInfo' | null;
  /** CLI 命令：成功时 payload.dataType。 */
  successDataType?: string;
  /** CLI 命令：可能出现的 jprint_error 函数名（payload.message）。 */
  errorMessages?: readonly string[];
  timeoutMs: number;
  /** 收到 progress 时重置超时计时器。 */
  progressResetsTimeout?: boolean;
  /** 源码位置。 */
  source: string;
}

const DOWNLOAD_ERRORS = [
  'invalid activation code format',
  'confirmation code required',
  'es10a_get_euicc_configured_addresses',
  'smdp is null',
  'es10b_get_euicc_challenge_and_info',
  'es9p_initiate_authentication',
  'es10b_authenticate_server',
  'es9p_authenticate_client',
  'es10b_prepare_download',
  'es9p_get_bound_profile_package',
  'es10b_load_bound_profile_package',
] as const;

export const LEGACY_COMMANDS = {
  getElpaInfo: {
    id: 'getElpaInfo',
    label: '读取读卡器信息',
    kind: 'json',
    readOnly: true,
    responseCmd: 'getElpaInfo',
    timeoutMs: 6000,
    source: 'src/message_handler.cpp: get_elpa_info',
  },
  getWifiInfo: {
    id: 'getWifiInfo',
    label: '读取 Wi-Fi 状态',
    kind: 'json',
    readOnly: true,
    responseCmd: 'getWifiInfo',
    timeoutMs: 6000,
    source: 'src/message_handler.cpp: get_wifi',
  },
  setWifiInfo: {
    id: 'setWifiInfo',
    label: '设置 Wi-Fi',
    kind: 'json',
    readOnly: false,
    responseCmd: null,
    timeoutMs: 0,
    source: 'src/message_handler.cpp: set_wifi（固件不回复，需要随后用 getWifiInfo 确认）',
  },
  version: {
    id: 'version',
    label: 'lpac 版本',
    kind: 'cli',
    readOnly: true,
    successDataType: 'version',
    errorMessages: [],
    timeoutMs: 8000,
    source: 'src/app/applet/version.c',
  },
  chipInfo: {
    id: 'chipInfo',
    label: '读取芯片信息',
    kind: 'cli',
    readOnly: true,
    successDataType: 'chipInfo',
    errorMessages: ['es10c_get_eid'],
    timeoutMs: 30000,
    source: 'src/app/applet/chip/info.c',
  },
  profileList: {
    id: 'profileList',
    label: '读取 Profile 列表',
    kind: 'cli',
    readOnly: true,
    successDataType: 'profileList',
    errorMessages: ['es10c_get_profiles_info'],
    timeoutMs: 45000,
    source: 'src/app/applet/profile/list.c',
  },
  notificationList: {
    id: 'notificationList',
    label: '读取通知列表',
    kind: 'cli',
    readOnly: true,
    successDataType: 'notificationList',
    errorMessages: ['es10b_list_notification'],
    timeoutMs: 30000,
    source: 'src/app/applet/notification/list.c',
  },
  enableProfile: {
    id: 'enableProfile',
    label: '启用 Profile',
    kind: 'cli',
    readOnly: false,
    successDataType: 'enableProfile',
    errorMessages: ['es10c_enable_profile'],
    timeoutMs: 45000,
    source: 'src/app/applet/profile/enable.c',
  },
  disableProfile: {
    id: 'disableProfile',
    label: '停用 Profile',
    kind: 'cli',
    readOnly: false,
    successDataType: 'disableProfile',
    errorMessages: ['es10c_disable_profile'],
    timeoutMs: 45000,
    source: 'src/app/applet/profile/disable.c',
  },
  deleteProfile: {
    id: 'deleteProfile',
    label: '删除 Profile',
    kind: 'cli',
    readOnly: false,
    successDataType: 'deleteProfile',
    errorMessages: ['es10c_delete_profile'],
    timeoutMs: 60000,
    source: 'src/app/applet/profile/delete.c',
  },
  setNickname: {
    id: 'setNickname',
    label: '修改昵称',
    kind: 'cli',
    readOnly: false,
    successDataType: 'setNickname',
    errorMessages: ['es10c_set_nickname'],
    timeoutMs: 30000,
    source: 'src/app/applet/profile/nickname.c',
  },
  downloadProfile: {
    id: 'downloadProfile',
    label: '下载并安装 Profile',
    kind: 'cli',
    readOnly: false,
    successDataType: 'downloadProfile',
    errorMessages: DOWNLOAD_ERRORS,
    // 每一步之间可能包含一次到 SM-DP+ 的 HTTPS 请求（固件 HTTP 超时 60 秒），
    // 所以每收到一条进度就重置计时器。
    timeoutMs: 150000,
    progressResetsTimeout: true,
    source: 'src/app/applet/profile/download.c',
  },
  discovery: {
    id: 'discovery',
    label: 'SM-DS 发现',
    kind: 'cli',
    readOnly: true,
    successDataType: 'discovery',
    errorMessages: [
      'es10b_get_euicc_challenge_and_info',
      'es9p_initiate_authentication',
      'es10b_authenticate_server',
      'es11_authenticate_client',
    ],
    timeoutMs: 150000,
    progressResetsTimeout: true,
    source: 'src/app/applet/profile/discovery.c',
  },
  notificationProcessAll: {
    id: 'notificationProcessAll',
    label: '发送全部通知',
    kind: 'cli',
    readOnly: false,
    successDataType: 'notificationProcess',
    errorMessages: ['es10b_list_notification', 'es10b_retrieve_notifications_list', 'es9p_handle_notification', 'es10b_remove_notification_from_list'],
    timeoutMs: 150000,
    progressResetsTimeout: true,
    source: 'src/app/applet/notification/process.c',
  },
  notificationRemoveAll: {
    id: 'notificationRemoveAll',
    label: '移除全部通知',
    kind: 'cli',
    readOnly: false,
    successDataType: 'notificationRemove',
    errorMessages: ['es10b_list_notification', 'es10b_remove_notification_from_list'],
    timeoutMs: 60000,
    progressResetsTimeout: true,
    source: 'src/app/applet/notification/remove.c',
  },
} as const satisfies Record<string, LegacyCommandSpec>;

export type LegacyCommandId = keyof typeof LEGACY_COMMANDS;

// ---------------------------------------------------------------------------
// 参数校验
// ---------------------------------------------------------------------------

/** ICCID：19–20 位数字（可带 F 填充）。 */
export function validateIccid(iccid: string): string {
  const v = iccid.trim();
  if (!/^\d{18,20}[Ff]?$/.test(v)) throw new CommandValidationError('ICCID 格式不正确（应为 18–20 位数字）。');
  return v;
}

/** ISD-P AID：32 位十六进制（固件按长度 32 区分 AID 与 ICCID）。 */
export function validateAid(aid: string): string {
  const v = aid.trim();
  if (!/^[0-9A-Fa-f]{32}$/.test(v)) throw new CommandValidationError('AID 格式不正确（应为 32 位十六进制）。');
  return v;
}

/**
 * 昵称：SGP.22 规定 profileNickname 为 UTF8String (SIZE(0..64))。
 * 固件按空格切分参数，因此昵称中不能有空格。空字符串表示清除昵称
 * （nickname.c：argc ≤ 2 时 new_name = ""）。
 */
export function validateNickname(nickname: string): string {
  if (nickname === '') return nickname;
  if (/\s/.test(nickname)) throw new CommandValidationError('昵称不能包含空格（旧版固件只按空格切分参数）。可以用下划线或连字符代替。');
  if (new TextEncoder().encode(nickname).length > 64) throw new CommandValidationError('昵称超过 64 字节（SGP.22 上限）。中文每个字占 3 字节。');
  if (nickname.startsWith('-')) throw new CommandValidationError('昵称不能以 “-” 开头。');
  return nickname;
}

export const commandBuilders = {
  getElpaInfo: () => buildJsonCommand('getElpaInfo'),
  getWifiInfo: () => buildJsonCommand('getWifiInfo'),
  setWifiInfo: (ssid: string, password: string) => {
    if (!ssid) throw new CommandValidationError('SSID 不能为空。');
    if (new TextEncoder().encode(ssid).length > 32) throw new CommandValidationError('SSID 超过 32 字节。');
    if (new TextEncoder().encode(password).length > 64) throw new CommandValidationError('Wi-Fi 密码超过 64 字节。');
    return buildJsonCommand('setWifiInfo', { ssid, password });
  },
  version: () => buildLpacCommand(['version']),
  chipInfo: () => buildLpacCommand(['chip', 'info']),
  profileList: () => buildLpacCommand(['profile', 'list']),
  notificationList: () => buildLpacCommand(['notification', 'list']),
  // enable/disable 不传 refreshflag：固件默认 0（见 enable.c / disable.c）
  enableProfile: (iccid: string) => buildLpacCommand(['profile', 'enable', validateIccid(iccid)]),
  disableProfile: (iccid: string) => buildLpacCommand(['profile', 'disable', validateIccid(iccid)]),
  deleteProfile: (iccid: string) => buildLpacCommand(['profile', 'delete', validateIccid(iccid)]),
  setNickname: (iccid: string, nickname: string) => {
    const n = validateNickname(nickname);
    return buildLpacCommand(n ? ['profile', 'nickname', validateIccid(iccid), n] : ['profile', 'nickname', validateIccid(iccid)]);
  },
  /** 见 activationCode.ts：使用 -s / -m / -c 传参，避免固件 -a 解析的 strtok 缺陷。 */
  downloadProfile: (args: { smdp: string; matchingId: string | null; confirmationCode: string | null }) => {
    const tokens = ['profile', 'download', '-s', validateDownloadArg(args.smdp, 'SM-DP+ 地址')];
    if (args.matchingId) tokens.push('-m', validateDownloadArg(args.matchingId, 'Matching ID'));
    if (args.confirmationCode) tokens.push('-c', validateDownloadArg(args.confirmationCode, '确认码'));
    return buildLpacCommand(tokens);
  },
  discovery: () => buildLpacCommand(['profile', 'discovery']),
  notificationProcessAll: (remove: boolean) => buildLpacCommand(remove ? ['notification', 'process', '-a', '-r'] : ['notification', 'process', '-a']),
  notificationRemoveAll: () => buildLpacCommand(['notification', 'remove', '-a']),
} satisfies Record<LegacyCommandId, (...args: never[]) => string>;

/**
 * download.c 用 `strncmp(argv[i], "-s", 2)` 这样的前缀匹配逐个检查 **所有** argv
 * （包括参数值本身），所以参数值不能以 “-” 开头，否则会被当成选项。
 */
export function validateDownloadArg(value: string, label: string): string {
  validateCliArg(value, label);
  if (value.startsWith('-')) throw new CommandValidationError(`${label}不能以 “-” 开头（固件会把它误认为选项）。`);
  return value;
}
