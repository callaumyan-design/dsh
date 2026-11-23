import QRCode from 'qrcode';
import { expect, test, type Page } from '@playwright/test';
import { fakeBluetoothScript } from './fixtures/bundle';

/** 二维码导入：真实 PNG 图片 → 浏览器内解码 → 填入激活码。蓝牙部分为 Mock BLE。 */

const AC = 'LPA:1$rsp.example.com$QR-TEST-0001';

async function png(text: string, opts: QRCode.QRCodeToBufferOptions = {}) {
  return QRCode.toBuffer(text, { margin: 4, width: 360, ...opts });
}

async function openInstall(page: Page) {
  await page.addInitScript({ content: fakeBluetoothScript() });
  await page.goto('/#/install');
  await page.getByRole('button', { name: '连接读卡器' }).first().click();
  await expect(page.getByTestId('qr-dropzone')).toBeVisible();
}

/** 在页面里构造带图片文件的 DataTransfer，用于拖放 / 粘贴。 */
async function dispatchWithFile(page: Page, kind: 'drop' | 'paste', bytes: Buffer, type = 'image/png') {
  await page.evaluate(
    ({ kind, b64, type }) => {
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([arr], 'qr.png', { type }));
      if (kind === 'drop') {
        const target = document.querySelector('main')!;
        target.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
        target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
        target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      } else {
        document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      }
    },
    { kind, b64: bytes.toString('base64'), type },
  );
}

test('选择二维码图片 → 自动填入激活码并解析', async ({ page }) => {
  await openInstall(page);
  await page.getByTestId('qr-file-input').setInputFiles({ name: 'qr.png', mimeType: 'image/png', buffer: await png(AC) });
  await expect(page.getByLabel('激活码')).toHaveValue(AC);
  await expect(page.getByText('来自二维码')).toBeVisible();
  await expect(page.getByText('rsp.example.com').first()).toBeVisible();
  await expect(page.getByRole('button', { name: '下载并安装' })).toBeEnabled();
});

test('把二维码图片拖到页面上', async ({ page }) => {
  await openInstall(page);
  // 透明背景 + 链接包装的激活码
  await dispatchWithFile(page, 'drop', await png(`https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=${encodeURIComponent(AC)}`, { color: { dark: '#000000ff', light: '#00000000' } }));
  await expect(page.getByLabel('激活码')).toHaveValue(AC);
  // 页面没有被浏览器导航到图片
  expect(page.url()).toContain('#/install');
});

test('Ctrl+V 粘贴截图', async ({ page }) => {
  await openInstall(page);
  await dispatchWithFile(page, 'paste', await png(AC, { width: 160 }));
  await expect(page.getByLabel('激活码')).toHaveValue(AC);
});

test('不是激活码的二维码给出明确提示', async ({ page }) => {
  await openInstall(page);
  await page.getByTestId('qr-file-input').setInputFiles({ name: 'wifi.png', mimeType: 'image/png', buffer: await png('WIFI:S:home;T:WPA;P:secret;;') });
  await expect(page.getByText('不是 eSIM 激活码').first()).toBeVisible();
  await expect(page.getByLabel('激活码')).toHaveValue('');
});

test('激活码不会进入日志', async ({ page }) => {
  await openInstall(page);
  await page.getByTestId('qr-file-input').setInputFiles({ name: 'qr.png', mimeType: 'image/png', buffer: await png(AC) });
  await expect(page.getByLabel('激活码')).toHaveValue(AC);
  await page.getByRole('link', { name: '诊断' }).click();
  await page.getByRole('tab', { name: '日志' }).click();
  await expect(page.getByTestId('log-view')).not.toContainText('QR-TEST-0001');
});
