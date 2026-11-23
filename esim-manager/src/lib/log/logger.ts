import { redactText } from '@/lib/protocol/redact';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogCategory = 'env' | 'ble' | 'tx' | 'rx' | 'protocol' | 'app';

export interface LogEntry {
  id: number;
  ts: number;
  level: LogLevel;
  category: LogCategory;
  message: string;
  /** 已脱敏的附加内容（例如 JSON）。 */
  detail?: string;
}

const MAX_ENTRIES = 3000;

/**
 * 内存日志（不写 localStorage）。所有文本写入前再做一次正则脱敏，作为最后一道防线；
 * 调用方仍应先用 redactJsonForLog / redactCommand 做结构化脱敏。
 */
export class Logger {
  private entries: LogEntry[] = [];
  private nextId = 1;
  private listeners = new Set<() => void>();
  private snapshot: readonly LogEntry[] = [];

  log(level: LogLevel, category: LogCategory, message: string, detail?: string): void {
    const entry: LogEntry = {
      id: this.nextId++,
      ts: Date.now(),
      level,
      category,
      message: redactText(message),
      detail: detail === undefined ? undefined : redactText(detail),
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    this.snapshot = [...this.entries];
    for (const l of this.listeners) l();
  }

  debug = (category: LogCategory, message: string, detail?: string) => this.log('debug', category, message, detail);
  info = (category: LogCategory, message: string, detail?: string) => this.log('info', category, message, detail);
  warn = (category: LogCategory, message: string, detail?: string) => this.log('warn', category, message, detail);
  error = (category: LogCategory, message: string, detail?: string) => this.log('error', category, message, detail);

  getSnapshot = (): readonly LogEntry[] => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  clear(): void {
    this.entries = [];
    this.snapshot = [];
    for (const l of this.listeners) l();
  }

  /** 导出为纯文本（已脱敏）。 */
  exportText(header: Record<string, string>): string {
    const head = Object.entries(header)
      .map(([k, v]) => `# ${k}: ${redactText(v)}`)
      .join('\n');
    const body = this.entries
      .map((e) => `${new Date(e.ts).toISOString()} [${e.level.toUpperCase()}] [${e.category}] ${e.message}${e.detail ? `\n    ${e.detail}` : ''}`)
      .join('\n');
    return `${head}\n\n${body}\n`;
  }

  /** 导出为 JSON（已脱敏）。 */
  exportJson(header: Record<string, string>): string {
    const safeHeader = Object.fromEntries(Object.entries(header).map(([k, v]) => [k, redactText(v)]));
    return JSON.stringify({ header: safeHeader, entries: this.entries }, null, 2);
  }
}
