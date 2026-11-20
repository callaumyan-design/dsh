import { expect, test, type Page } from '@playwright/test';

// 固定汇率，方便断言：1 USD = 7 CNY = 150 JPY = 0.9 EUR …
const usd: Record<string, number> = { USD: 1, CNY: 7, HKD: 7.8, EUR: 0.9, JPY: 150, GBP: 0.75, AUD: 1.5, KRW: 1400, THB: 35, SGD: 1.3, CAD: 1.4 };
const prev: Record<string, number> = { ...usd, CNY: 7.07 };
const API = { date: '2026-11-20', prevDate: '2026-11-19', source: 'fawazahmed0/exchange-api', rates: usd, prev, fetchedAt: 1 };

const row = (page: Page, code: string) => page.locator(`.row[data-code="${code}"]`);
const amount = (page: Page, code: string) => row(page, code).locator('.amount');

async function open(page: Page, opts: { offline?: boolean } = {}) {
  await page.route('**/api/rates', (r) => (opts.offline ? r.abort() : r.fulfill({ json: API })));
  // 不让测试访问外网
  await page.route(/jsdelivr|currency-api|er-api/, (r) => r.abort());
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(row(page, 'CNY')).toBeVisible();
}

async function keys(page: Page, labels: string[]) {
  for (const l of labels) await page.locator('.keypad').getByRole('button', { name: l, exact: true }).click();
}

test('默认以 100 人民币换算各货币，并显示单位汇率和涨跌', async ({ page }) => {
  await open(page);
  await expect(row(page, 'CNY')).toHaveClass(/is-active/);
  await expect(amount(page, 'CNY')).toHaveText('100');
  await expect(amount(page, 'USD')).toHaveText('14.29');
  await expect(amount(page, 'JPY')).toHaveText('2,142.86');
  await expect(row(page, 'USD').locator('.sub-text')).toHaveText('1 USD = 7.0000 CNY');
  await expect(row(page, 'JPY').locator('.sub-text')).toHaveText('100 JPY = 4.6667 CNY');
  // 人民币升值 → 美元兑人民币下跌
  await expect(row(page, 'USD').locator('.chg')).toHaveText('−0.99%');
  await expect(page.locator('.status')).toContainText('11月20日');
});

test('用数字键盘输入并连续计算', async ({ page }) => {
  await open(page);
  await keys(page, ['清零', '2', '0', '0', '乘', '3', '加', '1', '0', '0']);
  await expect(amount(page, 'CNY')).toHaveText('200 × 3 + 100');
  await expect(row(page, 'CNY').locator('.sub-text')).toHaveText('= 700.00');
  await expect(amount(page, 'USD')).toHaveText('100.00');
  await keys(page, ['等于']);
  await expect(amount(page, 'CNY')).toHaveText('700');
  await keys(page, ['退格']);
  await expect(amount(page, 'CNY')).toHaveText('70');
});

test('点另一行切换输入货币，金额随之带过去', async ({ page }) => {
  await open(page);
  await row(page, 'USD').click();
  await expect(row(page, 'USD')).toHaveClass(/is-active/);
  await expect(amount(page, 'USD')).toHaveText('14.29');
  // 第一次输入替换原来的数字
  await keys(page, ['5']);
  await expect(amount(page, 'USD')).toHaveText('5');
  await expect(amount(page, 'CNY')).toHaveText('35.00');
  await expect(row(page, 'CNY').locator('.sub-text')).toHaveText('1 CNY = 0.1429 USD');
});

test('电脑键盘输入', async ({ page, isMobile }) => {
  test.skip(isMobile, '只在电脑上测试');
  await open(page);
  await page.keyboard.press('Escape');
  await page.keyboard.type('12.5*2');
  await expect(amount(page, 'CNY')).toHaveText('12.5 × 2');
  await page.keyboard.press('Enter');
  await expect(amount(page, 'CNY')).toHaveText('25');
  await page.keyboard.press('ArrowDown');
  await expect(row(page, 'USD')).toHaveClass(/is-active/);
});

test('添加、移除货币，刷新后保留', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: '添加货币' }).click();
  await page.locator('#currency-search').fill('taizhu');
  await page.getByRole('button', { name: /THB 泰铢/ }).click();
  await page.getByRole('button', { name: '完成' }).click();
  await expect(row(page, 'THB')).toBeVisible();
  await expect(amount(page, 'THB')).toHaveText('500.00');

  await page.getByRole('button', { name: '编辑列表' }).click();
  await page.getByRole('button', { name: '移除 港币' }).click();
  await page.getByRole('button', { name: '完成' }).click();
  await expect(row(page, 'HKD')).toHaveCount(0);

  await page.reload();
  await expect(row(page, 'THB')).toBeVisible();
  await expect(row(page, 'HKD')).toHaveCount(0);
});

test('拖动调整顺序', async ({ page, isMobile }) => {
  test.skip(isMobile, '拖动在电脑上测试');
  await open(page);
  await page.getByRole('button', { name: '编辑列表' }).click();
  const handle = page.getByRole('button', { name: '拖动排序 澳元' });
  const target = row(page, 'CNY');
  const a = (await handle.boundingBox())!;
  const b = (await target.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, a.y - 10, { steps: 4 });
  await page.mouse.move(a.x + a.width / 2, b.y + 4, { steps: 20 });
  await page.mouse.up();
  await page.getByRole('button', { name: '完成' }).click();
  await expect(page.locator('.row').first()).toHaveAttribute('data-code', 'AUD');
});

test('长按复制金额', async ({ page, context, isMobile }) => {
  test.skip(isMobile, '剪贴板权限在电脑上测试');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page);
  await row(page, 'JPY').click({ button: 'right' });
  await expect(page.locator('.toast')).toHaveText('已复制 2142.86 JPY');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('2142.86');
  // 复制不切换输入货币
  await expect(row(page, 'CNY')).toHaveClass(/is-active/);
});

test('网络不可用时使用内置汇率', async ({ page }) => {
  await open(page, { offline: true });
  await expect(page.locator('.status')).toContainText('内置数据');
  await expect(amount(page, 'USD')).not.toHaveText('—');
});

test('设置：小数位数和深色模式', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: '设置' }).click();
  await page.getByRole('radio', { name: '4' }).click();
  await page.getByRole('radio', { name: '深色' }).click();
  await page.getByRole('button', { name: '关闭' }).click();
  await expect(amount(page, 'USD')).toHaveText('14.2857');
  await expect(page.locator('html')).toHaveAttribute('data-app-theme', 'dark');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).not.toBe('rgb(251, 251, 252)');
});

test('页面不横向滚动', async ({ page }) => {
  await open(page);
  await keys(page, ['9', '9', '9', '9', '9', '9', '9', '9', '9', '9', '9', '9']);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});
