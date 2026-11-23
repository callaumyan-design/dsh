import { commandBuilders } from '@/lib/protocol/legacy/commands';

/**
 * 诊断控制台允许的只读命令白名单。任何会修改卡片、读卡器配置或触发联网/OTA 的命令
 * （enable/disable/delete/nickname/download/purge/defaultsmdp/process/remove/
 * setWifiInfo/upgradeSoftware/checkUpdate）都不在这里，控制台会直接拒绝。
 */
export const READ_ONLY_COMMANDS = [
  { id: 'getElpaInfo', text: commandBuilders.getElpaInfo(), label: '读卡器信息', note: '返回内容包含 Wi-Fi 密码，本应用在显示和记录前会脱敏。' },
  { id: 'getWifiInfo', text: commandBuilders.getWifiInfo(), label: 'Wi-Fi 状态', note: '同样包含 Wi-Fi 密码，已脱敏。' },
  { id: 'version', text: commandBuilders.version(), label: 'lpac 版本', note: '不访问卡片。' },
  { id: 'chipInfo', text: commandBuilders.chipInfo(), label: '芯片信息', note: 'EID、EUICCInfo2、默认 SM-DP+ 等。' },
  { id: 'profileList', text: commandBuilders.profileList(), label: 'Profile 列表', note: '' },
  { id: 'notificationList', text: commandBuilders.notificationList(), label: '通知列表', note: '' },
] as const;

export type ReadOnlyCommandId = (typeof READ_ONLY_COMMANDS)[number]['id'];

export class ConsoleCommandRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConsoleCommandRejected';
  }
}

const WRITE_HINTS: Array<[RegExp, string]> = [
  [/\b(enable|disable|delete|nickname)\b/i, '启用 / 停用 / 删除 / 改名请在 Profiles 页面使用带确认的流程。'],
  [/\bdownload\b/i, '下载请在“安装 eSIM”页面操作。'],
  [/\b(purge|defaultsmdp)\b/i, '该命令会清空或修改 eUICC 配置，本应用不提供。'],
  [/\b(process|remove)\b/i, '通知处理请在 Profiles 页面的“通知”区域操作。'],
  [/setWifiInfo/i, 'Wi-Fi 配置请在“设备设置”页面操作。'],
  [/upgradeSoftware|checkUpdate/i, '固件更新相关命令不会从本应用发出。'],
  [/"APDU"/i, 'APDU 协议探测请使用诊断页的专用按钮。'],
];

/** 把用户输入映射到白名单命令；不在白名单中的一律拒绝。 */
export function classifyConsoleCommand(input: string): ReadOnlyCommandId {
  const byId = READ_ONLY_COMMANDS.find((c) => c.id === input);
  if (byId) return byId.id;

  const text = input.trim();
  if (!text) throw new ConsoleCommandRejected('请输入命令。');

  if (text.startsWith('{')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ConsoleCommandRejected('JSON 格式不正确。');
    }
    const cmd = typeof parsed === 'object' && parsed !== null ? (parsed as { cmd?: unknown }).cmd : undefined;
    const keys = typeof parsed === 'object' && parsed !== null ? Object.keys(parsed) : [];
    if ((cmd === 'getElpaInfo' || cmd === 'getWifiInfo') && keys.length === 1) return cmd;
    const hint = WRITE_HINTS.find(([re]) => re.test(text));
    throw new ConsoleCommandRejected(hint ? `已拒绝：${hint[1]}` : '控制台只允许 {"cmd":"getElpaInfo"} 和 {"cmd":"getWifiInfo"} 两个 JSON 命令。');
  }

  const tokens = text.split(/\s+/);
  // 允许用户省略程序名，但要提醒固件需要它
  const args = tokens[0] === 'lpac' ? tokens.slice(1) : tokens;
  const joined = args.join(' ');
  const map: Record<string, ReadOnlyCommandId> = {
    version: 'version',
    'chip info': 'chipInfo',
    'profile list': 'profileList',
    'notification list': 'notificationList',
  };
  const id = map[joined];
  if (id) return id;
  const hint = WRITE_HINTS.find(([re]) => re.test(joined));
  throw new ConsoleCommandRejected(hint ? `已拒绝：${hint[1]}` : `不在只读白名单中：${joined}。允许：lpac version / lpac chip info / lpac profile list / lpac notification list。`);
}
