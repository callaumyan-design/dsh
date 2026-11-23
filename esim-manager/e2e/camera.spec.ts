import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import QRCode from 'qrcode';
import { expect, test } from '@playwright/test';
import { fakeBluetoothScript } from './fixtures/bundle';

/**
 * 摄像头扫描：用 Chromium 的虚拟摄像头播放一段画面是二维码的 Y4M 视频。
 * 验证 getUserMedia → 逐帧识别 → 填入激活码 → 释放摄像头 这条链路（Mock BLE、虚拟摄像头）。
 */
const AC = 'LPA:1$rsp.example.com$CAMERA-0042';

function writeY4m(text: string): string {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const W = 640;
  const H = 480;
  const scale = Math.floor((H * 0.7) / (n + 8));
  const size = (n + 8) * scale;
  const ox = Math.floor((W - size) / 2);
  const oy = Math.floor((H - size) / 2);
  const y = Buffer.alloc(W * H, 200); // 灰色背景，模拟桌面
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const mx = Math.floor(px / scale) - 4;
      const my = Math.floor(py / scale) - 4;
      const dark = mx >= 0 && my >= 0 && mx < n && my < n && qr.modules.get(my, mx) === 1;
      y[(oy + py) * W + ox + px] = dark ? 16 : 235;
    }
  }
  const uv = Buffer.alloc((W / 2) * (H / 2), 128);
  const frame = Buffer.concat([Buffer.from('FRAME\n'), y, uv, uv]);
  const dir = join(tmpdir(), '9esim-e2e');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'qr-camera.y4m');
  writeFileSync(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`), frame, frame, frame]));
  return file;
}

test.use({
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${writeY4m(AC)}`],
  },
});

test('摄像头扫描二维码并自动关闭摄像头', async ({ page, context }) => {
  await context.grantPermissions(['camera']);
  await page.addInitScript({ content: fakeBluetoothScript() });
  await page.goto('/#/install');
  await page.getByRole('button', { name: '连接读卡器' }).first().click();
  await page.getByRole('button', { name: '摄像头扫描' }).click();
  await expect(page.locator('#ac')).toHaveValue(AC, { timeout: 15000 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // 摄像头已释放：页面上没有仍在运行的视频轨道
  const live = await page.evaluate(() => Array.from(document.querySelectorAll('video')).some((v) => (v.srcObject as MediaStream | null)?.getTracks().some((t) => t.readyState === 'live')));
  expect(live).toBe(false);
});
