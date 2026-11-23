/** e2e 专用：伪 Web Serial 端口，按固件日志格式输出几行模拟的下载过程。 */
export const fakeSerialScript = `(() => {
  const L = (f, n, m) => '[2026-11-23 12:49:40.123456]\\x1b[0;32m ' + f.padEnd(20) + ' line:' + String(n).padEnd(4) + '   ' + m + '\\x1b[0m\\n';
  const lines = [
    L('config.cpp', 52, 'SSID: HomeWiFi, Password: hunter2'),
    L('lpac_wrapper.cpp', 55, 'argv[5]: -m'),
    L('lpac_wrapper.cpp', 55, 'argv[6]: SECRET-MATCH'),
    L('iso7816.cpp', 41, 'TX[125]80E2110378BF3681A0BF2381AB800100'),
    L('iso7816.cpp', 45, 'RX[ 2]9000'),
    L('iso7816.cpp', 41, 'TX[125]80E2110578A382100C8E00000000000000'),
    L('iso7816.cpp', 45, 'RX[ 2]6A84'),
  ];
  const port = {
    readable: new ReadableStream({ start(c) { const e = new TextEncoder(); let i = 0; const t = setInterval(() => { if (i >= lines.length) { clearInterval(t); return; } c.enqueue(e.encode(lines[i++])); }, 30); } }),
    async open() {}, async close() {}, async setSignals() {},
    getInfo() { return { usbVendorId: 0x1a86, usbProductId: 0x7523 }; },
  };
  Object.defineProperty(navigator, 'serial', { configurable: true, value: { requestPort: async () => port, addEventListener() {} } });
})();`;
