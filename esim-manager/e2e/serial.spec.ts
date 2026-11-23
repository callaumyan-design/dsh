import { expect, test } from '@playwright/test';
import { fakeSerialScript } from './fixtures/fakeSerial';

/** USB 串口日志：伪 Web Serial 端口（不是真实读卡器）。验证脱敏与状态字提示。 */
test('串口日志：脱敏显示并标出异常状态字', async ({ page }) => {
  await page.addInitScript({ content: fakeSerialScript });
  await page.goto('/#/diagnostics?tab=serial');
  await page.getByRole('button', { name: '连接串口' }).click();
  const view = page.getByTestId('serial-view');
  await expect(view).toContainText('6A84');
  await expect(page.getByTestId('serial-summary')).toContainText('存储空间不足');
  await expect(view).not.toContainText('SECRET-MATCH');
  await page.getByRole('switch', { name: '只看 APDU / 错误 / HTTP' }).click();
  await expect(view).toContainText('Password');
  await expect(view).not.toContainText('hunter2');
});
