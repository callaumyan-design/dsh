import { expect, test, type Page } from '@playwright/test';
import { fakeBluetoothScript } from './fixtures/bundle';

/** 生成文档截图（Mock BLE 数据，仅用于展示界面）。设置 SCREENSHOTS=1 时运行。 */
test.skip(!process.env.SCREENSHOTS, '仅在 SCREENSHOTS=1 时生成截图');

const OUT = 'docs/screenshots';

async function setup(page: Page, theme: 'light' | 'dark' = 'light') {
  await page.addInitScript((t) => localStorage.setItem('9esim-web-manager.theme', t), theme);
  await page.addInitScript({ content: fakeBluetoothScript() });
  await page.goto('/#/dashboard');
}

async function connect(page: Page) {
  await page.getByRole('button', { name: '连接读卡器' }).first().click();
  await expect(page.getByText('v2.2.1')).toBeVisible();
  await expect(page.getByText('已插入 eUICC')).toBeVisible();
  await page.waitForTimeout(300);
}

test('desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 900 });
  await setup(page);
  await page.screenshot({ path: `${OUT}/welcome.png` });
  await connect(page);
  await page.screenshot({ path: `${OUT}/dashboard.png` });
  await page.getByRole('link', { name: 'eSIM Profiles' }).click();
  await page.getByRole('button', { name: '读取' }).first().click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/profiles.png`, fullPage: true });
  await page.getByTestId('profile-card').nth(1).getByRole('button', { name: '删除' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/delete-confirm.png` });
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: '安装 eSIM' }).click();
  await page.getByLabel('激活码').fill('LPA:1$rsp.example.com$ABCD-EFGH-1234');
  await page.screenshot({ path: `${OUT}/install.png`, fullPage: true });
  await page.getByRole('link', { name: '设备设置' }).click();
  await page.screenshot({ path: `${OUT}/settings.png`, fullPage: true });
  await page.getByRole('link', { name: '诊断' }).click();
  await page.getByRole('tab', { name: '统计' }).click();
  await page.screenshot({ path: `${OUT}/diagnostics-stats.png` });
  await page.getByRole('tab', { name: '日志' }).click();
  await page.screenshot({ path: `${OUT}/diagnostics-logs.png` });
});

test('dark + mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, 'dark');
  await page.screenshot({ path: `${OUT}/mobile-welcome-dark.png` });
  await connect(page);
  await page.screenshot({ path: `${OUT}/mobile-dashboard-dark.png`, fullPage: true });
  await page.getByRole('link', { name: 'Profiles' }).click();
  await page.screenshot({ path: `${OUT}/mobile-profiles-dark.png`, fullPage: true });
});
