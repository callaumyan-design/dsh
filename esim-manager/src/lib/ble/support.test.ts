import { describe, expect, it } from 'vitest';
import { evaluateSupport } from './support';

const bt = { requestDevice: () => Promise.reject(new Error('x')), getAvailability: () => Promise.resolve(true) } as unknown as Bluetooth;
const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1';
const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0';

describe('evaluateSupport', () => {
  it('Chrome + localhost 可用', () => {
    const s = evaluateSupport({ nav: { userAgent: CHROME_WIN, bluetooth: bt }, secureContext: true, protocol: 'http:', hostname: 'localhost', availability: 'available' });
    expect(s.usable).toBe(true);
    expect(s.problems).toEqual([]);
  });

  it('非安全上下文不可用', () => {
    const s = evaluateSupport({ nav: { userAgent: CHROME_WIN, bluetooth: bt }, secureContext: false, protocol: 'http:', hostname: '192.168.1.5' });
    expect(s.usable).toBe(false);
    expect(s.problems[0]).toContain('安全上下文');
  });

  it('iOS（即使是 Chrome）明确提示不支持', () => {
    const s = evaluateSupport({ nav: { userAgent: IPHONE }, secureContext: true, protocol: 'https:', hostname: 'x' });
    expect(s.usable).toBe(false);
    expect(s.platform.isIOS).toBe(true);
    expect(s.problems.join()).toContain('iOS');
  });

  it('Safari / Firefox', () => {
    expect(evaluateSupport({ nav: { userAgent: SAFARI }, secureContext: true, protocol: 'https:', hostname: 'x' }).problems.join()).toContain('Safari');
    expect(evaluateSupport({ nav: { userAgent: FIREFOX }, secureContext: true, protocol: 'https:', hostname: 'x' }).problems.join()).toContain('Firefox');
  });

  it('跨源 iframe 中不可用（Chrome 禁止）', () => {
    const s = evaluateSupport({ nav: { userAgent: CHROME_WIN, bluetooth: bt }, secureContext: true, protocol: 'https:', hostname: 'x', frame: 'cross-origin-frame' });
    expect(s.usable).toBe(false);
    expect(s.problems.join()).toContain('iframe');
  });

  it('file:// 在 Chrome 中是安全上下文', () => {
    const s = evaluateSupport({ nav: { userAgent: CHROME_WIN, bluetooth: bt }, secureContext: true, protocol: 'file:', hostname: '' });
    expect(s.usable).toBe(true);
  });

  it('没有蓝牙适配器', () => {
    const s = evaluateSupport({ nav: { userAgent: CHROME_WIN, bluetooth: bt }, secureContext: true, protocol: 'https:', hostname: 'x', availability: 'unavailable' });
    expect(s.usable).toBe(true);
    expect(s.problems.join()).toContain('适配器');
  });
});
