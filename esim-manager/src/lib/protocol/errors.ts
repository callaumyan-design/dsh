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
    /** 之前是否已经报告过 euicc_init 失败（V2.1.0 等没有 cardStatus 的固件在未插卡时会这样）。 */
    readonly euiccInitFailed = false,
  ) {
    super(
      describeLpacError(functionName, detail) +
        (euiccInitFailed ? ' 在此之前 euicc_init 也失败了：很可能未插卡、卡片接触不良，或插入的不是 eUICC。' : ''),
    );
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

/** eUICC 在 ProfileInstallationResult 中报告的 errorReason（SGP.22，lpac 的字符串形式）。 */
export const BPP_ERROR_REASONS: Record<string, string> = {
  incorrect_input_values: '输入值不正确',
  invalid_signature: '签名无效',
  invalid_transaction_id: '事务 ID 无效',
  unsupported_crt_values: '不支持的 CRT 参数',
  unsupported_remote_operation_type: '不支持的远程操作类型',
  unsupported_profile_class: '卡片不支持该 Profile 类别',
  scp03t_structure_error: 'SCP03t 结构错误',
  scp03t_security_error: 'SCP03t 安全校验错误',
  install_failed_due_to_iccid_already_exists_on_euicc: '卡上已存在相同 ICCID 的 Profile',
  install_failed_due_to_insufficient_memory_for_profile: '卡片存储空间不足',
  install_failed_due_to_interruption: '安装过程被中断',
  install_failed_due_to_pe_processing_error: '卡片处理 Profile 元素时出错（Profile 内容与这张卡不兼容的常见表现）',
  install_failed_due_to_iccid_mismatch: 'ICCID 不匹配',
  test_profile_install_failed_due_to_invalid_naa_key: '测试 Profile 的 NAA 密钥无效',
  ppr_not_allowed: '策略规则（PPR）不允许',
  install_failed_due_to_unknown_error: '卡片报告未知错误',
};

/**
 * es10b_load_bound_profile_package 的细节是 "<bppCommandId>,<errorReason>"。
 * 固件（src/euicc/es10b.c）在每段发送前把两者设为 UNDEFINED，只有成功解析出卡片返回的
 * ProfileInstallationResult/ErrorResult 才会覆盖——所以 "unknown,unknown" 表示
 * **固件没有拿到卡片的安装结果**，而不是卡片说了“未知错误”。
 */
export function describeBppFailure(detail: string): string {
  const [command = '', reason = ''] = detail.split(',');
  if (command === 'unknown' && reason === 'unknown') {
    return (
      '把 Profile 写入 eUICC 时失败，而且固件没有拿到卡片返回的安装结果（unknown,unknown）。' +
      '按固件源码，这只会在三种情况下出现：读卡器与卡片之间的 APDU 传输出错、卡片回复了非 9000/61xx 的状态字、或卡片的回复无法解析。' +
      '这不是激活码格式或网页的问题——微信小程序调用的是同一段固件代码，所以表现相同。'
    );
  }
  const reasonText = BPP_ERROR_REASONS[reason] ?? reason;
  return `eUICC 拒绝安装：${reasonText}（阶段 ${command || '未知'}）。`;
}

export function describeLpacError(functionName: string, detail: string): string {
  if (functionName === 'es10b_load_bound_profile_package' && detail.includes(',')) {
    return `${describeBppFailure(detail)}（${functionName}：${detail}）`;
  }
  const hint = FUNCTION_HINTS[functionName] ?? `lpac 返回错误：${functionName}`;
  return detail ? `${hint}（${functionName}：${detail}）` : `${hint}（${functionName}）`;
}
