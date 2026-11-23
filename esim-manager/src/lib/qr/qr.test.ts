import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';
import { candidateSizes, decodeImageData, extractActivationCode, QrError } from './qr';

/** 用 qrcode 生成模块矩阵，再渲染成 RGBA 像素（不依赖 canvas）。 */
function render(text: string, { scale = 6, margin = 4, invert = false } = {}) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const size = (n + margin * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const mx = Math.floor(x / scale) - margin;
      const my = Math.floor(y / scale) - margin;
      const dark = mx >= 0 && my >= 0 && mx < n && my < n && qr.modules.get(my, mx) === 1;
      const v = dark !== invert ? 0 : 255;
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width: size, height: size };
}

describe('extractActivationCode', () => {
  it('标准 LPA 内容', () => {
    expect(extractActivationCode('LPA:1$rsp.example.com$ABC-123')).toBe('LPA:1$rsp.example.com$ABC-123');
    expect(extractActivationCode('  lpa:1$rsp.example.com$X\n')).toBe('LPA:1$rsp.example.com$X');
    expect(extractActivationCode('1$rsp.example.com$X')).toBe('1$rsp.example.com$X');
  });

  it('包在链接里（含 URL 编码）', () => {
    expect(extractActivationCode('https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=LPA:1$rsp.example.com$ABC')).toBe('LPA:1$rsp.example.com$ABC');
    expect(extractActivationCode('https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=LPA%3A1%24rsp.example.com%24ABC%2D1&x=1')).toBe('LPA:1$rsp.example.com$ABC-1');
  });

  it('不是激活码时报错', () => {
    expect(() => extractActivationCode('https://example.com')).toThrow(QrError);
    expect(() => extractActivationCode('WIFI:S:home;T:WPA;P:x;;')).toThrow(/不是 eSIM 激活码/);
  });
});

describe('decodeImageData (jsQR)', () => {
  it('解码生成的激活码二维码', () => {
    const ac = 'LPA:1$rsp.example.com$K2-1A2B3C-4D5E6F$$1';
    expect(decodeImageData(render(ac))).toBe(ac);
  });

  it('反色二维码也能识别', () => {
    const ac = 'LPA:1$smdp.io$INV';
    expect(decodeImageData(render(ac, { invert: true }))).toBe(ac);
  });

  it('没有二维码返回 null', () => {
    const blank = { data: new Uint8ClampedArray(100 * 100 * 4).fill(255), width: 100, height: 100 };
    expect(decodeImageData(blank)).toBeNull();
  });
});

describe('candidateSizes', () => {
  it('大图缩小、小图放大', () => {
    expect(candidateSizes(4000, 3000)).toEqual(expect.arrayContaining([1600, 900, 2400]));
    expect(candidateSizes(200, 200)).toEqual([200, 400]);
  });
});
