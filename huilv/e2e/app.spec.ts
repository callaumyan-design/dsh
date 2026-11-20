import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const HISTORY = JSON.parse(readFileSync(new URL('./fixtures/usdcny-3m.json', import.meta.url), 'utf8'));

// 固定汇率，方便断言：1 USD = 7 CNY = 150 JPY = 0.9 EUR …
const usd: Record<string, number> = { USD: 1, CNY: 7, HKD: 7.8, EUR: 0.9, JPY: 150, GBP: 0.75, AUD: 1.5, KRW: 1400, THB: 35, SGD: 1.3, CAD: 1.4 };
const prev: Record<string, number> = { ...usd, CNY: 7.07 };
const API = { date: '2026-11-20', prevDate: '2026-11-19', source: 'fawazahmed0/exchange-api', rates: usd, prev, fetchedAt: 1 };

const row = (page: Page, code: string) => page.locator(`.row[data-code="${code}"]`);
const rowsGroup = (page: Page) => page.getByRole('radiogroup', { name: '每屏行数' });
/** 宽屏（电脑）上走势在右侧栏，窄屏上是弹出面板 */
const isWide = (page: Page) => (page.viewportSize()?.width ?? 0) >= 960;
const trendBox = (page: Page, pair: string) =>
  isWide(page) ? page.getByRole('region', { name: `${pair} 走势` }) : page.getByRole('dialog', { name: `${pair} 走势` });
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
  // 先移除一种，保证屏幕没放满
  await page.getByRole('button', { name: '编辑列表' }).click();
  await page.getByRole('button', { name: '移除 港币' }).click();
  await page.getByRole('button', { name: '完成' }).click();
  await expect(row(page, 'HKD')).toHaveCount(0);

  await page.getByRole('button', { name: '添加货币' }).first().click();
  await page.locator('#currency-search').fill('taizhu');
  await page.getByRole('button', { name: /THB 泰铢/ }).click();
  await page.getByRole('button', { name: '完成' }).click();
  await expect(row(page, 'THB')).toBeVisible();
  await expect(amount(page, 'THB')).toHaveText('500.00');

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
  await swipe(page, 'EUR', -120, isMobile);
  const box = trendBox(page, 'EUR/CNY');
  await expect(box).toBeVisible();
  await expect(box.locator('.pair-code')).toHaveText('EUR / CNY');
  await expect(box.locator('.chart svg g.k-up, .chart svg g.k-down')).toHaveCount(HISTORY.candles.length);
  await expect(box.locator('.trend-last')).toHaveText('6.6683');
  await expect(box.locator('.ohlc')).toContainText('收 6.6683');

  // 切换时间范围
  const req = page.waitForRequest((r) => r.url().includes('range=1y'));
  await box.getByRole('radio', { name: '1年' }).click();
  await req;
  await expect(box.locator('.trend-span')).toHaveText('近1年');

  // 反转货币对
  const inv = page.waitForRequest((r) => r.url().includes('from=CNY&to=EUR'));
  await box.getByRole('button', { name: '反转为 CNY/EUR' }).click();
  await inv;
  await expect(trendBox(page, 'CNY/EUR')).toBeVisible();
});

test('走势图上移动查看某一天', async ({ page, isMobile }) => {
  test.skip(isMobile, '鼠标悬停在电脑上测试');
  await open(page);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowLeft');
  const box = trendBox(page, 'USD/CNY');
  await expect(box).toBeVisible();
  const hit = (await box.locator('.k-hit').boundingBox())!;
  await page.mouse.move(hit.x + 3, hit.y + hit.height / 2);
  await expect(box.locator('.ohlc-date')).toHaveText(/8月20日$/);
  await expect(box.locator('.k-cross')).toBeVisible();
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
  await swipe(page, 'HKD', -45, false, 4);
  await expect(trendBox(page, 'HKD/CNY')).toBeVisible();
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

test('按屏幕高度固定行数：行等高、正好放满、不能上下滚动', async ({ page }) => {
  // 矮一点的屏幕
  await page.setViewportSize({ width: 390, height: 600 });
  await open(page);
  const slots = Number(await page.locator('.list').getAttribute('data-slots'));
  expect(slots).toBeGreaterThanOrEqual(3);
  expect(slots).toBeLessThan(7);
  await expect(page.locator('.row-wrap')).toHaveCount(slots);
  const m = await page.evaluate(() => {
    const l = document.querySelector('.list')!;
    const hs = [...document.querySelectorAll('.row-wrap')].map((r) => r.getBoundingClientRect().height);
    return { scrollable: l.scrollHeight > l.clientHeight + 1, min: Math.min(...hs), max: Math.max(...hs) };
  });
  expect(m.scrollable).toBe(false);
  expect(m.max - m.min).toBeLessThan(1);
  expect(m.min).toBeGreaterThanOrEqual(64);

  // 放满时添加：替换最后一行，然后关闭面板
  const last = await page.locator('.row').nth(slots - 1).getAttribute('data-code');
  await page.getByRole('button', { name: '添加货币' }).click();
  await expect(page.locator('.pick-note')).toContainText(`最多显示 ${slots} 种`);
  await page.locator('#currency-search').fill('THB');
  await page.getByRole('button', { name: /THB 泰铢/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.row').nth(slots - 1)).toHaveAttribute('data-code', 'THB');
  await expect(row(page, last!)).toHaveCount(0);
});

test('屏幕变矮时当前输入的货币仍在屏幕上；放不下的货币不会丢', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await open(page);
  await row(page, 'AUD').click();
  await expect(row(page, 'AUD')).toHaveClass(/is-active/);
  await page.setViewportSize({ width: 390, height: 600 });
  await expect(row(page, 'AUD')).toHaveCount(0);
  await expect(page.locator('.row').first()).toHaveClass(/is-active/);
  // 编辑模式里能看到放不下的货币
  await page.getByRole('button', { name: '编辑列表' }).click();
  await expect(page.locator('.row.is-edit[data-code="AUD"] .tag')).toHaveText('放不下');
  await page.getByRole('button', { name: '完成' }).click();
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(row(page, 'AUD')).toBeVisible();
});

test('货币比行数少时显示“添加货币”空位', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: '编辑列表' }).click();
  for (const name of ['港币', '欧元', '日元']) await page.getByRole('button', { name: `移除 ${name}` }).click();
  await page.getByRole('button', { name: '完成' }).click();
  await expect(page.locator('.add-slot')).toBeVisible();
  await page.locator('.add-slot').click();
  await expect(page.getByRole('dialog', { name: '添加货币' })).toBeVisible();
});

test('电脑宽屏：两栏布局，悬停按钮可以看走势、更换、复制', async ({ page, context, isMobile }) => {
  test.skip(isMobile, '电脑布局');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page);
  await expect(page.locator('.app')).toHaveClass(/is-wide/);
  // 键盘和走势都在右栏，默认显示第一个非输入货币的走势
  await expect(page.locator('.side .keypad')).toBeVisible();
  await expect(trendBox(page, 'USD/CNY')).toBeVisible();
  const listBox = (await page.locator('.list').boundingBox())!;
  const sideBox = (await page.locator('.side').boundingBox())!;
  expect(sideBox.x).toBeGreaterThan(listBox.x + listBox.width - 1);

  await row(page, 'JPY').hover();
  await page.getByRole('button', { name: '查看 JPY 走势' }).click();
  await expect(trendBox(page, 'JPY/CNY')).toBeVisible();
  await expect(row(page, 'JPY').locator('.focus-mark')).toBeVisible();
  // 看走势不会切换输入货币
  await expect(row(page, 'CNY')).toHaveClass(/is-active/);

  await row(page, 'GBP').hover();
  await page.getByRole('button', { name: '复制 GBP 金额' }).click();
  await expect(page.locator('.toast')).toHaveText('已复制 10.71 GBP');

  await row(page, 'HKD').hover();
  await page.getByRole('button', { name: '更换 HKD' }).click();
  await expect(page.getByRole('dialog', { name: /把 HKD 港币换成/ })).toBeVisible();
});

test('设置里手动指定每屏行数，刷新后保留', async ({ page }) => {
  await open(page);
  const auto = Number(await page.locator('.list').getAttribute('data-slots'));
  await page.getByRole('button', { name: '设置' }).click();
  await rowsGroup(page).getByRole('radio', { name: '手动' }).click();
  await expect(page.locator('.stepper output')).toHaveText(`${auto} 行`);
  await page.getByRole('button', { name: '减少一行' }).click();
  await page.getByRole('button', { name: '减少一行' }).click();
  await expect(page.locator('.stepper output')).toHaveText(`${auto - 2} 行`);
  await page.getByRole('button', { name: '关闭' }).click();
  await expect(page.locator('.list')).toHaveAttribute('data-slots', String(auto - 2));
  await expect(page.locator('.row-wrap')).toHaveCount(Math.min(7, auto - 2));
  // 行更少，每行更高，仍然正好放满
  const scrollable = await page.evaluate(() => {
    const l = document.querySelector('.list')!;
    return l.scrollHeight > l.clientHeight + 1;
  });
  expect(scrollable).toBe(false);

  await page.reload();
  await expect(page.locator('.list')).toHaveAttribute('data-slots', String(auto - 2));

  // 改回自动
  await page.getByRole('button', { name: '设置' }).click();
  await rowsGroup(page).getByRole('radio', { name: '自动' }).click();
  await page.getByRole('button', { name: '关闭' }).click();
  await expect(page.locator('.list')).toHaveAttribute('data-slots', String(auto));
});

test('手动行数不超过屏幕能放下的上限', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await open(page);
  await page.getByRole('button', { name: '设置' }).click();
  await rowsGroup(page).getByRole('radio', { name: '手动' }).click();
  const plus = page.getByRole('button', { name: '增加一行' });
  for (let i = 0; i < 12 && (await plus.isEnabled()); i++) await plus.click();
  await expect(plus).toBeDisabled();
  const n = parseInt((await page.locator('.stepper output').textContent())!, 10);
  await page.getByRole('button', { name: '关闭' }).click();
  const h = await page.locator('.row-wrap').first().evaluate((e) => e.getBoundingClientRect().height);
  expect(h).toBeGreaterThanOrEqual(48);
  await expect(page.locator('.row-wrap')).toHaveCount(Math.min(n, 7));
});

/** 在某个元素上用触摸往下拖 dy 像素；fast 为快速一甩 */
async function touchDrag(page: Page, selector: string, dy: number, fast = false, at = 0.5) {
  const b = (await page.locator(selector).first().boundingBox())!;
  const x = b.x + b.width / 2;
  const y = b.y + b.height * at;
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', ty: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: ty }] });
  await touch('touchStart', y);
  const steps = fast ? 3 : 14;
  for (let i = 1; i <= steps; i++) {
    await touch('touchMove', y + (dy * i) / steps);
    if (!fast) await page.waitForTimeout(16);
  }
  await touch('touchEnd', y + dy);
}

test('走势面板往下拖动关闭；拖得不够会弹回', async ({ page, isMobile }) => {
  test.skip(!isMobile, '触摸手势在手机上测试');
  await open(page);
  await swipe(page, 'USD', -120, true);
  const sheet = page.getByRole('dialog', { name: 'USD/CNY 走势' });
  await expect(sheet.locator('.chart svg')).toBeVisible();

  // 拖一点点：弹回，面板还在
  await touchDrag(page, '.sheet-head', 40);
  await page.waitForTimeout(400);
  await expect(sheet).toBeVisible();
  expect(await sheet.evaluate((e) => (e as HTMLElement).style.transform)).toBe('');

  // 在图表上往下拖：是查看价格，不关闭
  await touchDrag(page, '.chart svg', 200);
  await page.waitForTimeout(400);
  await expect(sheet).toBeVisible();

  // 从标题往下拖足够远：关闭
  await touchDrag(page, '.sheet-head', 260);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('往下快速一甩也能关闭，从内容区往下拖也可以', async ({ page, isMobile }) => {
  test.skip(!isMobile, '触摸手势在手机上测试');
  await open(page);
  await page.getByRole('button', { name: '设置' }).click();
  await expect(page.getByRole('dialog', { name: '设置' })).toBeVisible();
  await touchDrag(page, '.sheet-grip', 70, true);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('button', { name: '设置' }).click();
  await expect(page.getByRole('dialog', { name: '设置' })).toBeVisible();
  await touchDrag(page, '.sheet-body', 260, false, 0.3);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('列表没滚到顶时，往下拖是滚动列表而不是关闭', async ({ page, isMobile }) => {
  test.skip(!isMobile, '触摸手势在手机上测试');
  await open(page);
  await page.getByRole('button', { name: '添加货币' }).click();
  const sheet = page.getByRole('dialog', { name: '添加货币' });
  await expect(sheet.locator('.pick').first()).toBeVisible();
  await sheet.locator('.sheet-body').evaluate((e) => (e.scrollTop = 600));
  await touchDrag(page, '.sheet-body', 200, false, 0.5);
  await page.waitForTimeout(400);
  await expect(sheet).toBeVisible();
  expect(await sheet.locator('.sheet-body').evaluate((e) => e.scrollTop)).toBeLessThan(600);
});
