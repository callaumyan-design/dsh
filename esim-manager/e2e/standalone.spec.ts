import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { fakeBluetoothScript } from './fixtures/bundle';

/** 单文件版本：直接以 file:// 打开（Mock BLE），确认双击打开也能完整工作。 */
const file = fileURLToPath(new URL('../standalone/9eSIM-Web-Manager.html', import.meta.url));

test.skip(!existsSync(file), '先运行 npm run build:single');

test('standalone 单文件以 file:// 打开可连接并读取', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript({ content: fakeBluetoothScript() });
  await page.goto(`file://${file}`);
  expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
  await page.getByRole('button', { name: '连接读卡器' }).first().click();
  await expect(page.getByText('v2.2.1')).toBeVisible();
  await expect(page.getByText('已插入 eUICC')).toBeVisible();
  await page.getByRole('link', { name: 'eSIM Profiles' }).click();
  await expect(page.getByTestId('profile-card')).toHaveCount(2);
  expect(errors).toEqual([]);
});
