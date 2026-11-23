/** 协议层错误类型。message 均为中文、可直接展示，且不含敏感信息。 */

export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}

/** lpac 通过 jprint_error 返回的错误：payload.message 是失败的函数名，payload.data 是细节。 */
export class LpacError extends ProtocolError {
  constructor(
    readonly functionName: string,
    readonly detail: string,
    readonly commandId: string,
  ) {
    super(describeLpacError(functionName, detail));
    this.name = 'LpacError';
  }
}

export class CardNotInsertedError extends ProtocolError {
  constructor() {
    super('读卡器报告未插入卡片（cardStatus.cardInserted = false）。请插入 eUICC 卡后重试。');
    this.name = 'CardNotInsertedError';
  }
}

export class ResponseTimeoutError extends ProtocolError {
  constructor(
    readonly commandLabel: string,
    readonly timeoutMs: number,
  ) {
    super(`「${commandLabel}」在 ${Math.round(timeoutMs / 1000)} 秒内没有收到设备回复。可能是固件不支持该命令、命令格式不被识别，或 BLE 通知被截断。`);
    this.name = 'ResponseTimeoutError';
  }
}

export class DisconnectedError extends ProtocolError {
  constructor(detail = '蓝牙连接已断开') {
    super(`${detail}，操作已中止。若这是写入操作，结果未知，请重新连接后刷新核对；不会自动重试。`);
    this.name = 'DisconnectedError';
  }
}

export class UnsupportedOperationError extends ProtocolError {
  constructor(operation: string, reason: string) {
    super(`当前协议不支持「${operation}」：${reason}`);
    this.name = 'UnsupportedOperationError';
  }
}

const FUNCTION_HINTS: Record<string, string> = {
  euicc_init: '无法初始化 eUICC（打开逻辑通道 / 选择 ISD-R 失败）。卡片可能不是 eUICC、接触不良，或尚未完成上电。',
  es10c_get_eid: '读取 EID 失败。',
  es10c_get_profiles_info: '读取 Profile 列表失败。',
  es10c_enable_profile: '启用 Profile 失败。',
  es10c_disable_profile: '停用 Profile 失败。',
  es10c_delete_profile: '删除 Profile 失败。',
  es10c_set_nickname: '修改昵称失败。',
  es10b_list_notification: '读取通知列表失败。',
  es10b_retrieve_notifications_list: '读取待发送通知失败。',
  es9p_handle_notification: '向 SM-DP+ 发送通知失败。',
  es10b_remove_notification_from_list: '移除通知失败。',
  'invalid activation code format': '激活码格式无效。',
  'confirmation code required': '该激活码需要确认码。',
  'smdp is null': '没有 SM-DP+ 地址，且卡内也没有默认 SM-DP+。',
  es10a_get_euicc_configured_addresses: '读取卡内配置的默认 SM-DP+ 地址失败。',
  es10b_get_euicc_challenge_and_info: '读取 eUICC 挑战值失败。',
  es9p_initiate_authentication: '与 SM-DP+ 的初始认证失败（检查读卡器 Wi-Fi、SM-DP+ 地址）。',
  es10b_authenticate_server: 'eUICC 验证 SM-DP+ 服务器失败（证书或 Matching ID 不被接受）。',
  es9p_authenticate_client: 'SM-DP+ 拒绝了客户端认证（激活码可能已使用、过期或与此 EID 不匹配）。',
  es10b_prepare_download: '准备下载失败（确认码错误或被拒绝）。',
  es9p_get_bound_profile_package: '从 SM-DP+ 获取 Profile 包失败。',
  es10b_load_bound_profile_package: '把 Profile 写入 eUICC 失败。',
  es11_authenticate_client: 'SM-DS 认证失败。',
};

export function describeLpacError(functionName: string, detail: string): string {
  const hint = FUNCTION_HINTS[functionName] ?? `lpac 返回错误：${functionName}`;
  return detail ? `${hint}（${functionName}：${detail}）` : `${hint}（${functionName}）`;
}
