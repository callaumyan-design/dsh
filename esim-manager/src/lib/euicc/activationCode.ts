/**
 * 激活码解析（GSMA SGP.22 v2.2.2 §4.1 Activation Code）：
 *
 *   [LPA:]1$<SM-DP+ 地址>$<AC_Token / Matching ID>[$<SM-DP+ OID>[$<确认码必需标志>]]
 *
 * 为什么不直接把整串激活码用 `-a` 交给固件：
 * eLPA 的 download.c 用 strtok(activation_code, "$") 切分，strtok 会把连续的 “$$”
 * 当作一个分隔符，导致空字段之后的字段整体错位（例如 `1$smdp$$1.3.6.1$1` 中
 * OID 会被当成 Matching ID）。因此本应用在浏览器里解析，再用 `-s` / `-m` / `-c`
 * 分别传参。
 */

export interface ParsedActivationCode {
  smdp: string;
  matchingId: string | null;
  oid: string | null;
  confirmationCodeRequired: boolean;
}

export class ActivationCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActivationCodeError';
  }
}

const FQDN = /^(?=.{1,253}$)(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))*(:\d{1,5})?$/;

export function looksLikeActivationCode(input: string): boolean {
  return /^\s*(LPA:)?1\$/i.test(input);
}

export function parseActivationCode(input: string): ParsedActivationCode {
  let text = input.trim();
  if (!text) throw new ActivationCodeError('请输入激活码。');
  if (/^LPA:/i.test(text)) text = text.slice(4);
  if (/\s/.test(text)) throw new ActivationCodeError('激活码中包含空格或换行，请检查是否复制完整。');

  const parts = text.split('$');
  if (parts[0] !== '1') throw new ActivationCodeError('激活码格式不支持：应以 “LPA:1$” 开头（AC_Format = 1）。');
  if (parts.length < 3) throw new ActivationCodeError('激活码缺少字段：至少需要 SM-DP+ 地址和 Matching ID 两段。');
  if (parts.length > 5) throw new ActivationCodeError('激活码字段过多（最多 5 段）。');

  const smdp = (parts[1] ?? '').trim();
  if (!smdp) throw new ActivationCodeError('激活码中的 SM-DP+ 地址为空。');
  if (!FQDN.test(smdp)) throw new ActivationCodeError(`SM-DP+ 地址 “${smdp}” 不是有效的域名。`);

  const matchingId = (parts[2] ?? '').trim() || null;
  if (matchingId && matchingId.startsWith('-')) throw new ActivationCodeError('Matching ID 不能以 “-” 开头。');

  const oid = (parts[3] ?? '').trim() || null;
  if (oid && !/^\d+(\.\d+)*$/.test(oid)) throw new ActivationCodeError('SM-DP+ OID 格式不正确。');

  const flag = (parts[4] ?? '').trim();
  if (flag && flag !== '1' && flag !== '0') throw new ActivationCodeError('确认码标志只能是 0 或 1。');

  return { smdp, matchingId, oid, confirmationCodeRequired: flag === '1' };
}

export function validateConfirmationCode(code: string): string {
  const c = code.trim();
  if (!c) throw new ActivationCodeError('请输入运营商提供的确认码。');
  if (/\s/.test(c)) throw new ActivationCodeError('确认码不能包含空格。');
  if (c.startsWith('-')) throw new ActivationCodeError('确认码不能以 “-” 开头。');
  if (c.length > 64) throw new ActivationCodeError('确认码过长。');
  return c;
}

/** download.c 中 jprint_progress_with_step 的函数名 → 中文。 */
export const DOWNLOAD_STAGES: Record<string, string> = {
  es10a_get_euicc_configured_addresses: '读取卡内默认 SM-DP+ 地址',
  es10b_get_euicc_challenge_and_info: '读取 eUICC 挑战值和信息',
  es9p_initiate_authentication: '与 SM-DP+ 建立认证',
  es10b_authenticate_server: 'eUICC 验证 SM-DP+',
  es9p_authenticate_client: 'SM-DP+ 验证 eUICC',
  es10b_prepare_download: '准备下载',
  es9p_get_bound_profile_package: '获取 Profile 包',
  es10b_load_bound_profile_package: '写入 Profile 到 eUICC',
  es11_authenticate_client: 'SM-DS 认证',
  es10b_list_notification: '读取通知列表',
  es10b_retrieve_notifications_list: '读取待发送通知',
  es9p_handle_notification: '发送通知到服务器',
  es10b_remove_notification_from_list: '移除已处理的通知',
};

/** download.c：total_steps 固定为 9；给出 -s 时第一步（读默认地址）被跳过。 */
export const DOWNLOAD_TOTAL_STEPS = 9;
