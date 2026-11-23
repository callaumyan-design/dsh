import { describe, expect, it } from 'vitest';
import { classifySerialLine, describeSw, SerialLogController, SerialRedactor } from './serialLog';

// 按固件 logs.cpp 的格式构造的示例行
const L = (file: string, line: number, msg: string) => `[2026-11-23 12:49:40.123456]\x1b[0;32m ${file.padEnd(20)} line:${String(line).padEnd(4)}   ${msg}\x1b[0m`;

describe('SerialRedactor', () => {
  it('隐藏 Wi-Fi 密码与下载参数', () => {
    const r = new SerialRedactor();
    expect(r.line(L('config.cpp', 52, 'SSID: HomeWiFi, Password: hunter2'))).not.toContain('hunter2');
    expect(r.line(L('message_handler.cpp', 152, 'message: lpac profile download -s rsp.example.com -m MATCH-1 -c 1234'))).toMatch(/-s rsp\.example\.com -m ‹已隐藏› -c ‹已隐藏›/);
    expect(r.line(L('ble_sim_uart_tt.cpp', 160, 'recv data[60]: {"cmd":"setWifiInfo","ssid":"a","password":"p@ss"}'))).not.toContain('p@ss');
  });

  it('argv 中 -m 后面的参数被隐藏', () => {
    const r = new SerialRedactor();
    expect(r.line(L('lpac_wrapper.cpp', 55, 'argv[5]: -m'))).toContain('-m');
    expect(r.line(L('lpac_wrapper.cpp', 55, 'argv[6]: MATCH-1'))).not.toContain('MATCH-1');
    expect(r.line(L('lpac_wrapper.cpp', 55, 'argv[7]: -c'))).toContain('-c');
  });

  it('十六进制 APDU 只保留指令头和状态字', () => {
    const eidResp = 'BF3E125A1089049032123451234512345678901235' + '9000';
    const out = new SerialRedactor().line(L('iso7816.cpp', 45, `RX[${eidResp.length / 2}]${eidResp}`));
    expect(out).toContain('BF3E125A10890490');
    expect(out).toContain('9000');
    expect(out).not.toContain('1234512345678901235');
  });

  it('长 base64 只保留长度', () => {
    const out = new SerialRedactor().line(L('esp32_http.cpp', 70, `Response[2000]: {"boundProfilePackage":"${'Qk'.repeat(200)}"}`));
    expect(out).toContain('base64 400');
  });
});

describe('classifySerialLine', () => {
  it('识别 APDU 与状态字', () => {
    expect(classifySerialLine(L('iso7816.cpp', 45, 'RX[ 2]9000'))).toEqual({ kind: 'apdu-rx', sw: '9000', abnormal: false });
    expect(classifySerialLine(L('iso7816.cpp', 45, 'RX[ 2]6A84'))).toEqual({ kind: 'apdu-rx', sw: '6A84', abnormal: true });
    expect(classifySerialLine(L('iso7816.cpp', 41, 'TX[125]80E211037800'))).toEqual({ kind: 'apdu-tx' });
    expect(classifySerialLine(L('smartcard.cpp', 350, 'Failed to receive data! err = 0')).kind).toBe('error');
  });

  it('状态字说明', () => {
    expect(describeSw('6A84')).toContain('存储空间不足');
    expect(describeSw('6900')).toContain('传输失败');
    expect(describeSw('6110')).toContain('16');
  });
});

describe('SerialLogController.ingest', () => {
  it('跨分片拼行并统计异常', () => {
    const c = new SerialLogController(undefined);
    c.ingest(L('iso7816.cpp', 45, 'RX[ 2]90').slice(0, 30));
    c.ingest(L('iso7816.cpp', 45, 'RX[ 2]9000').slice(30) + '\n' + L('iso7816.cpp', 45, 'RX[ 2]6A80') + '\n');
    c.ingest(L('smartcard.cpp', 350, 'Failed to receive data! err = 0') + '\n');
    const s = c.getSnapshot();
    expect(s.lines).toHaveLength(3);
    expect(s.abnormalCount).toBe(1);
    expect(s.lastAbnormal?.sw).toBe('6A80');
    expect(s.transportFailures).toBe(1);
    expect(c.exportText({ app: 't' })).toContain('[SW 6A80 数据字段错误');
  });
});
