/**
 * 敏感信息脱敏。日志、诊断导出、错误提示在写入前都必须经过这里。
 *
 * 规则：
 * - Wi-Fi 密码、激活码、Matching ID、确认码：完全隐藏。
 * - EID、ICCID：保留前 4 位和后 4 位。
 * - MAC：保留前 4 位。
 * - Wi-Fi SSID：只保留首字符（可能暴露住址/单位）。
 * - Profile 图标（base64）：只记录长度，避免日志过大。
 */

export const HIDDEN = '‹已隐藏›';

const SECRET_KEYS = /^(password|passwd|pwd|psk|activationCode|activation_code|matchingId|matching_id|confirmationCode|confirmation_code|cc|ac)$/i;
const ID_KEYS = /^(eid|eidValue|iccid)$/i;

export function maskId(value: string, keepStart = 4, keepEnd = 4): string {
  const v = value.trim();
  if (v.length <= keepStart + keepEnd) return '•'.repeat(Math.max(v.length, 4));
  return `${v.slice(0, keepStart)}${'•'.repeat(Math.min(v.length - keepStart - keepEnd, 12))}${v.slice(-keepEnd)}`;
}

export function maskSsid(value: string): string {
  if (!value) return value;
  return `${[...value][0]}•••`;
}

export function maskMac(value: string): string {
  if (!value) return value;
  return value.length <= 4 ? '••••' : `${value.slice(0, 4)}••••`;
}

/** 深拷贝并脱敏设备 JSON。 */
export function redactValue(value: unknown, key?: string): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redactValue(v));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactValue(v, k);
    return out;
  }
  if (typeof value === 'string' && key) {
    if (SECRET_KEYS.test(key)) return value ? HIDDEN : '';
    if (ID_KEYS.test(key)) return value ? maskId(value) : value;
    if (/^ssid$/i.test(key)) return maskSsid(value);
    if (/^mac$/i.test(key)) return maskMac(value);
    if (/^icon$/i.test(key) && value.length > 32) return `‹icon base64 ${value.length} 字符›`;
  }
  return value;
}

/**
 * 对任意文本做正则脱敏（用于无法解析的 JSON 片段、错误信息等）。
 * 也会处理被截断、没有闭合引号的密码字段。
 */
export function redactText(text: string): string {
  let out = text;
  // "password": "...."（含转义），以及被截断没有结尾引号的情况
  out = out.replace(/("(?:password|passwd|pwd|psk|matchingId|confirmationCode|activationCode)"\s*:\s*)"(?:[^"\\]|\\.)*("|$)/gi, (_m, p1: string, p2: string) => `${p1}"${HIDDEN}${p2 ? '"' : ''}`);
  // LPA:1$smdp$matchingId... 激活码
  out = out.replace(/LPA:1\$[^\s"']*/gi, `LPA:1$${HIDDEN}`);
  // EID：32 位数字
  out = out.replace(/(?<![0-9A-Fa-f])(\d{32})(?![0-9A-Fa-f])/g, (m) => maskId(m));
  // ICCID：89 开头 18–20 位（可能以 F 结尾填充）
  out = out.replace(/(?<![0-9A-Za-z])(89\d{16,18}[Ff]?)(?![0-9A-Za-z])/g, (m) => maskId(m));
  return out;
}

/** 把设备 JSON 消息转换成可以安全记录的字符串。 */
export function redactJsonForLog(value: unknown): string {
  try {
    return JSON.stringify(redactValue(value));
  } catch {
    return redactText(String(value));
  }
}

/**
 * 脱敏一条即将发送的命令文本（JSON 控制命令或 lpac CLI 文本）。
 */
export function redactCommand(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    try {
      return JSON.stringify(redactValue(JSON.parse(trimmed)));
    } catch {
      return redactText(trimmed);
    }
  }
  const tokens = trimmed.split(' ');
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] ?? '';
    const prev = tokens[i - 1] ?? '';
    if (/^-(m|c|a|i)$/.test(prev)) out.push(HIDDEN);
    else if (/^\d{19,20}[Ff]?$/.test(t) || /^[0-9A-Fa-f]{32}$/.test(t)) out.push(maskId(t));
    else out.push(redactText(t));
  }
  return out.join(' ');
}
