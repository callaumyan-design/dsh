import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const HISTORY = JSON.parse(readFileSync(new URL('./fixtures/usdcny-3m.json', import.meta.url), 'utf8'));

// 固定汇率，方便断言：1 USD = 7 CNY = 150 JPY = 0.9 EUR …
const usd: Record<string, number> = { USD: 1, CNY: 7, HKD: 7.8, EUR: 0.9, JPY: 150, GBP: 0.75, AUD: 1.5, KRW: 1400, THB: 35, SGD: 1.3, CAD: 1.4 };
const prev: Record<string, number> = { ...usd, CNY: 7.07 };
const API = { date: '2026-11-20', prevDate: '2026-11-19', source: 'fawazahmed0/exchange-api', rates: usd, prev, fetchedAt: 1 };

const row = (page: Page, code: string) => page.locator(`.row[data-code="${code}"]`);
const amount = (page: Page, code: string) => row(page, code).locator('.amount');

async function open(page: Page, opts: { offline?: boolean; hint?: boolean } = {}) {
  await page.route('**/api/rates', (r) => (opts.offline ? r.abort() : r.fulfill({ json: API })));
  await page.route('**/api/history**', (r) => {
    if (opts.offline) return r.abort();
    const u = new URL(r.request().url());
    return r.fulfill({ json: { ...HISTORY, from: u.searchParams.get('from'), to: u.searchParams.get('to'), range: u.searchParams.get('range') } });
  });
  // 不让测试访问外网
  await page.route(/jsdelivr|currency-api|er-api|frankfurter/, (r) => r.abort());
  await page.goto('./');
  await page.evaluate((hint) => {
    localStorage.clear();
    // 默认跳过第一次使用时的滑动提示动画
    if (!hint) localStorage.setItem('huilv:hint-swipe', '1');
  }, !!opts.hint);
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

/** 在一行上横向滑动：电脑用鼠标，手机用触摸 */
async function swipe(page: Page, code: string, dx: number, isMobile: boolean, steps = 10) {
  const b = (await row(page, code).boundingBox())!;
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  if (isMobile) {
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', tx: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: tx, y }] });
    await touch('touchStart', x);
    for (let i = 1; i <= steps; i++) await touch('touchMove', x + (dx * i) / steps);
    await touch('touchEnd', x + dx);
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y, { steps });
    await page.mouse.up();
  }
}

/** 长按一行，然后竖向移动 dy（0 表示不移动直接松手） */
async function longPress(page: Page, code: string, dy: number, isMobile: boolean) {
  const b = (await row(page, code).boundingBox())!;
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  if (isMobile) {
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', ty: number) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: ty }] });
    await touch('touchStart', y);
    await page.waitForTimeout(450);
    for (let i = 1; i <= 12; i++) await touch('touchMove', y + (dy * i) / 12);
    await page.waitForTimeout(100);
    await touch('touchEnd', y + dy);
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForTimeout(450);
    if (dy) await page.mouse.move(x, y + dy, { steps: 12 });
    await page.waitForTimeout(100);
    await page.mouse.up();
  }
}

test('右滑一行更换货币', async ({ page, isMobile }) => {
  await open(page);
  await swipe(page, 'HKD', 120, isMobile);
  await expect(page.getByRole('dialog', { name: /把 HKD 港币换成/ })).toBeVisible();
  // 没有切换输入货币
  await expect(row(page, 'CNY')).toHaveClass(/is-active/);
  await page.locator('#currency-search').fill('THB');
  await page.getByRole('button', { name: /THB 泰铢/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(row(page, 'HKD')).toHaveCount(0);
  await expect(page.locator('.row').nth(2)).toHaveAttribute('data-code', 'THB');
  await expect(page.locator('.toast')).toHaveText('已将 HKD 换成 THB');
});

test('更换成已在列表里的货币时交换位置；更换当前输入货币时金额跟着换算', async ({ page }) => {
  await open(page);
  await row(page, 'USD').click();
  await keys(page, ['1', '0']);
  await swipe(page, 'USD', 120, false);
  await page.locator('#currency-search').fill('EUR');
  await page.getByRole('button', { name: /EUR 欧元/ }).click();
  await expect(page.locator('.row').nth(1)).toHaveAttribute('data-code', 'EUR');
  await expect(page.locator('.row').nth(3)).toHaveAttribute('data-code', 'USD');
  await expect(row(page, 'EUR')).toHaveClass(/is-active/);
  await expect(amount(page, 'EUR')).toHaveText('9');
});

test('短距离滑动不触发，也不会切换货币', async ({ page, isMobile }) => {
  await open(page);
  await swipe(page, 'USD', -20, isMobile);
  await swipe(page, 'USD', 20, isMobile);
  await page.waitForTimeout(300);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(row(page, 'CNY')).toHaveClass(/is-active/);
});

test('左滑一行查看走势 K 线', async ({ page, isMobile }) => {
  await open(page);
  await swipe(page, 'USD', -120, isMobile);
  const sheet = page.getByRole('dialog', { name: 'USD/CNY 走势' });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.pair-code')).toHaveText('USD / CNY');
  await expect(sheet.locator('.chart svg g.k-up, .chart svg g.k-down')).toHaveCount(HISTORY.candles.length);
  await expect(sheet.locator('.trend-last')).toHaveText('6.6683');
  await expect(sheet.locator('.ohlc')).toContainText('收 6.6683');

  // 切换时间范围
  const req = page.waitForRequest((r) => r.url().includes('range=1y'));
  await sheet.getByRole('radio', { name: '1年' }).click();
  await req;
  await expect(sheet.locator('.trend-span')).toHaveText('近1年');

  // 反转货币对
  const inv = page.waitForRequest((r) => r.url().includes('from=CNY&to=USD'));
  await sheet.getByRole('button', { name: '反转为 CNY/USD' }).click();
  await inv;
  await expect(page.getByRole('dialog', { name: 'CNY/USD 走势' })).toBeVisible();
});

test('走势图上移动查看某一天', async ({ page, isMobile }) => {
  test.skip(isMobile, '鼠标悬停在电脑上测试');
  await open(page);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowLeft');
  const sheet = page.getByRole('dialog', { name: 'USD/CNY 走势' });
  await expect(sheet).toBeVisible();
  const box = (await sheet.locator('.k-hit').boundingBox())!;
  await page.mouse.move(box.x + 3, box.y + box.height / 2);
  await expect(sheet.locator('.ohlc-date')).toHaveText('2026年8月20日');
  await expect(sheet.locator('.k-cross')).toBeVisible();
});

test('走势加载失败时可以重试', async ({ page }) => {
  await open(page, { offline: true });
  await swipe(page, 'USD', -120, false);
  await expect(page.getByText('暂时无法获取走势数据')).toBeVisible();
  await expect(page.getByRole('button', { name: '重试' })).toBeVisible();
});

test('第一次打开时提示可以左右滑动', async ({ page }) => {
  await open(page, { hint: true });
  await expect(page.locator('.row-wrap.is-peek')).toHaveAttribute('data-wrap', 'USD');
  await page.reload();
  await expect(page.locator('.row-wrap.is-peek')).toHaveCount(0);
});

test('快速一甩也能触发', async ({ page }) => {
  await open(page);
  // 只滑 45 像素，但速度很快
  await swipe(page, 'USD', -45, false, 4);
  await expect(page.getByRole('dialog', { name: 'USD/CNY 走势' })).toBeVisible();
});

test('长按后上下拖动调整顺序', async ({ page, isMobile }) => {
  await open(page);
  const h = (await row(page, 'USD').boundingBox())!.height;
  // 把 EUR（第 4 行）拖到第 2 行的位置
  await longPress(page, 'EUR', -2 * h, isMobile);
  await expect(page.locator('.row').nth(1)).toHaveAttribute('data-code', 'EUR');
  await expect(page.locator('.row').nth(2)).toHaveAttribute('data-code', 'USD');
  // 拖动不会切换输入货币，也不会复制
  await expect(row(page, 'CNY')).toHaveClass(/is-active/);
  await expect(page.locator('.toast')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.row').nth(1)).toHaveAttribute('data-code', 'EUR');
});

test('长按后直接松手复制金额', async ({ page, context, isMobile }) => {
  test.skip(isMobile, '剪贴板权限在电脑上测试');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page);
  await longPress(page, 'USD', 0, false);
  await expect(page.locator('.toast')).toHaveText('已复制 14.29 USD');
  await expect(row(page, 'CNY')).toHaveClass(/is-active/);
});
