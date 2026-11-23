import { expect, test, type Page } from '@playwright/test';
import { fakeBluetoothScript } from './fixtures/bundle';

/**
 * 界面端到端测试。蓝牙部分使用注入的 Mock BLE（固件模拟器），
 * 验证的是界面流程与安全确认，**不是真实硬件验证**。
 */

async function withFakeBle(page: Page, options: Record<string, unknown> = {}) {
  await page.addInitScript((opts) => {
    (window as unknown as { __FAKE_BLE_OPTIONS__: unknown }).__FAKE_BLE_OPTIONS__ = opts;
  }, options);
  await page.addInitScript({ content: fakeBluetoothScript() });
}

async function connect(page: Page) {
  await page.goto('/#/dashboard');
  await page.getByRole('button', { name: '连接读卡器' }).first().click();
  await expect(page.getByTestId('connection-pill').first()).toHaveAttribute('data-state', 'connected');
  await expect(page.getByText('v2.2.1')).toBeVisible();
}

test('不支持 Web Bluetooth 时明确提示且不能连接', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'bluetooth', { value: undefined, configurable: true }));
  await page.goto('/');
  await expect(page.getByText('此浏览器无法使用 Web Bluetooth')).toBeVisible();
  await expect(page.getByRole('button', { name: '连接读卡器' }).first()).toBeDisabled();
});

test('连接后自动只读读取：仪表盘显示真实回复，EID 默认脱敏', async ({ page }) => {
  await withFakeBle(page);
  await connect(page);
  await expect(page.getByText('已插入 eUICC')).toBeVisible();
  await expect(page.getByText('8904••••••••••••1235')).toBeVisible();
  await expect(page.getByText('89049032123451234512345678901235')).toHaveCount(0);
  const handled = await page.evaluate(() => window.__fakeBle!.sim.handled);
  expect(handled).toEqual(['{"cmd":"getElpaInfo"}', 'lpac chip info', 'lpac profile list']);
  await page.getByRole('button', { name: '显示EID' }).click();
  await expect(page.getByText('89049032123451234512345678901235')).toBeVisible();
});

test('Profiles：启用/停用需确认，删除需输入 ICCID 后 4 位', async ({ page }) => {
  await withFakeBle(page);
  await connect(page);
  await page.getByRole('link', { name: 'eSIM Profiles' }).click();
  const cards = page.getByTestId('profile-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toHaveAttribute('data-state', 'enabled');

  // 停用当前 Profile
  await cards.first().getByRole('button', { name: '停用' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('alertdialog').getByRole('button', { name: '停用' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.locator('[data-testid=profile-card][data-state=enabled]')).toHaveCount(0);

  // 删除：输入错误时按钮不可用
  const travel = cards.filter({ hasText: 'Travel SIM' });
  await travel.getByRole('button', { name: '删除' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByText('删除后通常无法恢复')).toBeVisible();
  const confirmBtn = dialog.getByRole('button', { name: '永久删除' });
  await expect(confirmBtn).toBeDisabled();
  await dialog.getByRole('textbox').fill('0000');
  await expect(confirmBtn).toBeDisabled();
  await dialog.getByRole('textbox').fill('1234');
  await confirmBtn.click();
  await expect(cards).toHaveCount(1);
  const handled = await page.evaluate(() => window.__fakeBle!.sim.handled);
  expect(handled).toContain('lpac profile delete 8986012345678901234');
});

test('改昵称：含空格时拒绝', async ({ page }) => {
  await withFakeBle(page);
  await connect(page);
  await page.getByRole('link', { name: 'eSIM Profiles' }).click();
  await page.getByTestId('profile-card').first().getByRole('button', { name: '昵称' }).click();
  const input = page.getByLabel('昵称', { exact: true });
  await input.fill('my sim');
  await expect(page.getByRole('button', { name: '保存' })).toBeDisabled();
  await input.fill('工作卡');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('工作卡')).toBeVisible();
});

test('安装 eSIM：解析激活码、检查 Wi-Fi、显示进度并刷新列表', async ({ page }) => {
  await withFakeBle(page);
  await connect(page);
  await page.getByRole('link', { name: '安装 eSIM' }).click();
  await page.getByLabel('激活码').fill('LPA:1$rsp.example.com$ABCD-EFGH$$1');
  await expect(page.getByText('rsp.example.com').first()).toBeVisible();
  await expect(page.getByLabel(/确认码/)).toBeVisible();
  const start = page.getByRole('button', { name: '下载并安装' });
  await expect(start).toBeDisabled();
  await page.getByLabel(/确认码/).fill('1234');
  await start.click();
  await page.getByRole('alertdialog').getByRole('button', { name: '开始下载' }).click();
  await expect(page.getByText('安装成功').first()).toBeVisible();
  const handled = await page.evaluate(() => window.__fakeBle!.sim.handled);
  expect(handled).toContain('lpac profile download -s rsp.example.com -m ABCD-EFGH -c 1234');
});

test('诊断：日志已脱敏，只读控制台拒绝写命令', async ({ page }) => {
  await withFakeBle(page);
  await connect(page);
  await page.getByRole('link', { name: '诊断' }).click();
  await page.getByRole('tab', { name: '只读指令' }).click();
  await page.getByRole('textbox', { name: '命令', exact: true }).fill('lpac chip purge yes');
  await page.getByRole('button', { name: '执行' }).click();
  await expect(page.getByText(/已拒绝/).first()).toBeVisible();
  await page.getByRole('tab', { name: '日志' }).click();
  const log = page.getByTestId('log-view');
  await expect(log).toContainText('getElpaInfo');
  await expect(log).not.toContainText('super-secret-pw');
  await expect(log).not.toContainText('89049032123451234512345678901235');
});

test('意外断开后界面复位并可重新连接', async ({ page }) => {
  await withFakeBle(page);
  await connect(page);
  await page.evaluate(() => window.__fakeBle!.device.simulateLinkLoss());
  await expect(page.getByTestId('connection-pill').first()).toHaveAttribute('data-state', 'disconnected');
  await expect(page.getByText('v2.2.1')).toHaveCount(0);
  await page.getByRole('button', { name: '重新连接' }).first().click();
  await expect(page.getByTestId('connection-pill').first()).toHaveAttribute('data-state', 'connected');
});

test('写入 eUICC 失败（unknown,unknown）：说明原因、自动只读核对、给出下一步', async ({ page }) => {
  await withFakeBle(page, { downloadFailsAt: 'es10b_load_bound_profile_package' });
  await connect(page);
  await page.getByRole('link', { name: '安装 eSIM' }).click();
  await page.locator('#ac').fill('LPA:1$rsp.example.com$ABCD');
  await page.getByRole('button', { name: '下载并安装' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '开始下载' }).click();
  await expect(page.getByText('安装失败').first()).toBeVisible();
  await expect(page.getByText('没有拿到卡片返回的安装结果').first()).toBeVisible();
  const report = page.getByTestId('download-report');
  await expect(report).toContainText('卡上新出现的 Profile：没有');
  await expect(report).toContainText('先别连续重试');
  const handled = await page.evaluate(() => window.__fakeBle!.sim.handled);
  expect(handled.slice(-3)).toEqual(['lpac profile download -s rsp.example.com -m ABCD', 'lpac profile list', 'lpac notification list']);
  await report.getByRole('button', { name: '打开 USB 串口日志' }).click();
  await expect(page.getByText('读卡器 USB 串口日志')).toBeVisible();
});
