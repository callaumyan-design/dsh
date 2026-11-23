/**
 * 设备消息分类。所有结构都来自 eLPA 固件源码：
 *
 * - `{"type":"lpa","payload":{"code":0,"message":"success","dataType":"…","data":…}}`
 *   src/app/jprint.c: jprint_success（cJSON_PrintUnformatted）
 * - `{"type":"lpa","payload":{"code":-1,"message":"<函数名>","data":"<细节>"}}`
 *   jprint_error
 * - `{"type":"progress","payload":{"code":0,"message":"<函数名>","data":"<细节>"[,"step":n,"total_steps":m]}}`
 *   jprint_progress / jprint_progress_with_step
 * - `{"cmd":"cardStatus","cardInserted":false}`
 *   src/message_handler.cpp（V2.2.1 才有；未插卡时收到任何非 JSON 文本都会回这个）
 * - `{"cmd":"getElpaInfo","data":{ssid,password,connected,rssi,time,hardware,firmware,software,hasNewSoftware,newSoftwareVersion,mac}}`
 * - `{"cmd":"getWifiInfo","data":{ssid,password,connected,rssi,time}}`
 * - `{"cmd":"upgrade","state":"…","total":n,"current":n}`  src/https_ota.cpp
 *
 * 另有 NekokoLPA 所用固件的 APDU 回复：`{"data":"<hex>"}` 或 `{"error":"…"}`
 * （官方 eLPA 源码与 V2.x 固件二进制中都没有该协议）。
 */

export interface LpaMessage {
  type: 'lpa';
  code: number;
  message: string;
  dataType: string | null;
  data: unknown;
}

export interface ProgressMessage {
  type: 'progress';
  code: number;
  message: string;
  data: unknown;
  step: number | null;
  totalSteps: number | null;
}

export interface CardStatusMessage {
  type: 'cardStatus';
  cardInserted: boolean;
}

export interface ElpaInfoMessage {
  type: 'elpaInfo';
  data: Record<string, unknown>;
}

export interface WifiInfoMessage {
  type: 'wifiInfo';
  data: Record<string, unknown>;
}

export interface UpgradeMessage {
  type: 'upgrade';
  state: string;
  total: number;
  current: number;
}

export interface ApduReplyMessage {
  type: 'apdu';
  data: string | null;
  error: string | null;
}

export interface UnknownMessage {
  type: 'unknown';
  value: unknown;
}

export type DeviceMessage =
  | LpaMessage
  | ProgressMessage
  | CardStatusMessage
  | ElpaInfoMessage
  | WifiInfoMessage
  | UpgradeMessage
  | ApduReplyMessage
  | UnknownMessage;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));

export function classifyMessage(value: unknown): DeviceMessage {
  if (!isObject(value)) return { type: 'unknown', value };

  if (value.type === 'lpa' && isObject(value.payload)) {
    const p = value.payload;
    return {
      type: 'lpa',
      code: num(p.code, -1),
      message: str(p.message),
      dataType: typeof p.dataType === 'string' ? p.dataType : null,
      data: p.data ?? null,
    };
  }

  if (value.type === 'progress' && isObject(value.payload)) {
    const p = value.payload;
    return {
      type: 'progress',
      code: num(p.code),
      message: str(p.message),
      data: p.data ?? null,
      step: typeof p.step === 'number' ? p.step : null,
      totalSteps: typeof p.total_steps === 'number' ? p.total_steps : null,
    };
  }

  if (typeof value.cmd === 'string') {
    switch (value.cmd) {
      case 'cardStatus':
        return { type: 'cardStatus', cardInserted: value.cardInserted === true };
      case 'getElpaInfo':
        return { type: 'elpaInfo', data: isObject(value.data) ? value.data : {} };
      case 'getWifiInfo':
        return { type: 'wifiInfo', data: isObject(value.data) ? value.data : {} };
      case 'upgrade':
        return { type: 'upgrade', state: str(value.state), total: num(value.total), current: num(value.current) };
      default:
        return { type: 'unknown', value };
    }
  }

  if (('data' in value && typeof value.data === 'string') || ('error' in value && typeof value.error === 'string')) {
    const keys = Object.keys(value);
    if (keys.every((k) => k === 'data' || k === 'error')) {
      return {
        type: 'apdu',
        data: typeof value.data === 'string' ? value.data : null,
        error: typeof value.error === 'string' && value.error ? value.error : null,
      };
    }
  }

  return { type: 'unknown', value };
}

export function describeMessage(msg: DeviceMessage): string {
  switch (msg.type) {
    case 'lpa':
      return msg.code === 0 ? `LPA 成功 dataType=${msg.dataType ?? 'null'}` : `LPA 错误 ${msg.message}${msg.data ? `：${str(msg.data)}` : ''}`;
    case 'progress':
      return `进度 ${msg.step !== null ? `${msg.step}/${msg.totalSteps ?? '?'} ` : ''}${msg.message}`;
    case 'cardStatus':
      return msg.cardInserted ? '卡状态：已插入' : '卡状态：未插卡';
    case 'elpaInfo':
      return '读卡器信息 getElpaInfo';
    case 'wifiInfo':
      return 'Wi-Fi 信息 getWifiInfo';
    case 'upgrade':
      return `固件升级状态 ${msg.state} ${msg.current}/${msg.total}`;
    case 'apdu':
      return msg.error ? `APDU 错误：${msg.error}` : `APDU 回复 ${msg.data?.length ?? 0} hex`;
    default:
      return '未知消息';
  }
}
