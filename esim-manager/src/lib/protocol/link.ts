import type { DeviceMessage } from './messages';

export interface IncomingMessage {
  message: DeviceMessage;
  /** 原始 JSON 文本（未脱敏，禁止直接写日志）。 */
  text: string;
  at: number;
}

export interface SendOptions {
  /** 协议允许的最大字节数，超过直接拒绝。 */
  maxBytes: number;
  /** 写日志用的标签。 */
  label: string;
}

/** 协议适配器与传输层之间的抽象：发送一条完整命令、订阅已解析的设备消息。 */
export interface MessageLink {
  send(text: string, options: SendOptions): Promise<void>;
  onMessage(listener: (message: IncomingMessage) => void): () => void;
  isConnected(): boolean;
}
