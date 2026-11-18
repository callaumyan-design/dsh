import { expect, test, type Page } from '@playwright/test';

const quad = (page: Page, q: string) => page.locator(`[data-quadrant="${q}"]`);
const card = (page: Page, title: string) => page.locator('.card', { hasText: title });

/** 每个测试从空白数据开始，关闭引导条 */
async function freshStart(page: Page) {
  await page.goto('./');
  await page.evaluate(() => {
    localStorage.setItem(
      'quadrant-planner:v1',
      JSON.stringify({ version: 1, tasks: [], prefs: { introDismissed: true, theme: 'light', showCompleted: true, smartParse: true, escalateDays: 1 } }),
    );
  });
  await page.reload();
}

async function addViaDialog(page: Page, text: string, q?: string) {
  await page.getByRole('button', { name: q ? undefined : '新建任务' }).first();
  if (q) await quad(page, q).getByRole('button', { name: /^添加到/ }).click();
  else if (await page.locator('.fab').isVisible()) await page.locator('.fab').click();
  else await page.getByRole('button', { name: /新建任务/ }).click();
  await page.locator('#add-title').fill(text);
  await page.keyboard.press('Enter');
}

/** 用鼠标或触摸把卡片拖到目标元素上 */
async function drag(page: Page, from: string, toSelector: string, isMobile: boolean) {
  const src = card(page, from);
  const a = (await src.boundingBox())!;
  const b = (await page.locator(toSelector).boundingBox())!;
  const sx = a.x + a.width / 2;
  const sy = a.y + Math.min(a.height / 2, 18);
  const tx = b.x + b.width / 2;
  const ty = b.y + b.height / 2;
  if (isMobile) {
    // dnd-kit TouchSensor：长按 220ms 后开始拖动
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: string, x: number, y: number) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await touch('touchStart', sx, sy);
    await page.waitForTimeout(350);
    for (let i = 1; i <= 12; i++) await touch('touchMove', sx + ((tx - sx) * i) / 12, sy + ((ty - sy) * i) / 12);
    await page.waitForTimeout(100);
    await touch('touchEnd', tx, ty);
  } else {
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 10, sy + 10, { steps: 3 });
    await page.mouse.move(tx, ty, { steps: 15 });
    await page.waitForTimeout(100);
    await page.mouse.up();
  }
  await page.waitForTimeout(300);
}

test('首次打开显示示例任务和引导', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByText('按“重要”和“紧急”两个维度给事情分类。')).toBeVisible();
  await expect(quad(page, 'q1').locator('.card').first()).toBeVisible();
  await page.getByRole('button', { name: '清空示例，开始使用' }).click();
  await expect(page.locator('.card:not(.is-done)')).toHaveCount(0);
});

test('智能识别新建任务并持久化', async ({ page }) => {
  await freshStart(page);
  await addViaDialog(page, '明天下午3点 写周报 #工作 !1');
  const c = card(page, '写周报');
  await expect(quad(page, 'q1').locator('.card', { hasText: '写周报' })).toBeVisible();
  await expect(c).toContainText('明天 15:00');
  await expect(c).toContainText('#工作');
  await page.reload();
  await expect(quad(page, 'q1').locator('.card', { hasText: '写周报' })).toBeVisible();
});

test('拖动卡片到其他象限', async ({ page, isMobile }) => {
  await freshStart(page);
  await addViaDialog(page, '整理桌面', 'q4');
  await expect(quad(page, 'q4').locator('.card', { hasText: '整理桌面' })).toBeVisible();
  await drag(page, '整理桌面', '[data-quadrant="q2"] .quad-body', isMobile);
  await expect(quad(page, 'q2').locator('.card', { hasText: '整理桌面' })).toBeVisible();
  await expect(quad(page, 'q4').locator('.card', { hasText: '整理桌面' })).toHaveCount(0);
  await page.reload();
  await expect(quad(page, 'q2').locator('.card', { hasText: '整理桌面' })).toBeVisible();
});

test('象限内拖动排序', async ({ page, isMobile }) => {
  await freshStart(page);
  await addViaDialog(page, '任务甲', 'q2');
  await addViaDialog(page, '任务乙', 'q2');
  await addViaDialog(page, '任务丙', 'q2');
  const titles = () => quad(page, 'q2').locator('.card:not(.is-done) .card-title').allTextContents();
  expect(await titles()).toEqual(['任务甲', '任务乙', '任务丙']);
  await drag(page, '任务丙', '[data-quadrant="q2"] .card:has-text("任务甲")', isMobile);
  expect((await titles())[0]).toBe('任务丙');
});

test('完成任务、撤销与已完成列表', async ({ page }) => {
  await freshStart(page);
  await addViaDialog(page, '买牛奶', 'q3');
  await card(page, '买牛奶').getByRole('checkbox').click();
  const toast = page.locator('.toast', { hasText: '已完成' });
  await expect(toast).toBeVisible();
  await expect(quad(page, 'q3').getByRole('button', { name: /已完成 1/ })).toBeVisible();
  await toast.getByRole('button', { name: '撤销' }).click();
  await expect(quad(page, 'q3').locator('.card:not(.is-done)', { hasText: '买牛奶' })).toBeVisible();
});

test('重复任务完成后生成下一次', async ({ page }) => {
  await freshStart(page);
  await addViaDialog(page, '每天 背单词', 'q2');
  await card(page, '背单词').getByRole('checkbox').click();
  await expect(page.locator('.toast', { hasText: '下一次' })).toBeVisible();
  await expect(quad(page, 'q2').locator('.card:not(.is-done)', { hasText: '背单词' })).toContainText('明天');
});

test('详情面板编辑子任务与象限', async ({ page }) => {
  await freshStart(page);
  await addViaDialog(page, '准备演讲', 'q2');
  await card(page, '准备演讲').click();
  const drawer = page.getByRole('dialog', { name: '任务详情' });
  await drawer.locator('#drawer-subtask').fill('写提纲');
  await drawer.locator('#drawer-subtask').press('Enter');
  await drawer.locator('#drawer-subtask').fill('做幻灯片');
  await drawer.locator('#drawer-subtask').press('Enter');
  await drawer.getByText('立即做').click();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(quad(page, 'q1').locator('.card', { hasText: '准备演讲' })).toContainText('0/2');
});

test('键盘：数字键移动、删除后撤销', async ({ page, isMobile }) => {
  test.skip(isMobile, '键盘操作只在桌面验证');
  await freshStart(page);
  await addViaDialog(page, '回电话', 'q1');
  await card(page, '回电话').focus();
  await page.keyboard.press('3');
  await expect(quad(page, 'q3').locator('.card', { hasText: '回电话' })).toBeVisible();
  await card(page, '回电话').focus();
  await page.keyboard.press('Delete');
  await expect(card(page, '回电话')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(quad(page, 'q3').locator('.card', { hasText: '回电话' })).toBeVisible();
});

test('日程与统计视图', async ({ page }) => {
  await page.goto('./#agenda');
  await expect(page.getByRole('heading', { name: /今天/ })).toBeVisible();
  await page.goto('./#stats');
  await expect(page.getByRole('heading', { name: '每日完成' })).toBeVisible();
  await expect(page.locator('.chart svg .bar').first()).toBeVisible();
  await page.getByRole('button', { name: '表格' }).click();
  await expect(page.locator('.data-table')).toBeVisible();
});

test('导出备份再导入', async ({ page }) => {
  await freshStart(page);
  await addViaDialog(page, '备份测试任务', 'q2');
  await page.getByRole('button', { name: '设置' }).first().click();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载备份' }).click();
  const file = await dl;
  const path = await file.path();
  await page.getByRole('button', { name: '清空全部任务' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '清空', exact: true }).click();
  await expect(page.locator('.toast', { hasText: '已清空' })).toBeVisible();
  await page.locator('#set-file').setInputFiles(path!);
  await page.getByRole('button', { name: '合并导入' }).click();
  await page.keyboard.press('Escape');
  await expect(quad(page, 'q2').locator('.card', { hasText: '备份测试任务' })).toBeVisible();
});

test('象限底部快速添加', async ({ page, isMobile }) => {
  test.skip(isMobile, '手机端用“+”按钮添加');
  await freshStart(page);
  const input = quad(page, 'q2').getByPlaceholder(/添加到“计划做”/);
  await input.fill('学习英语 每周三 #成长');
  await expect(quad(page, 'q2').locator('.quick-add .token')).toHaveCount(3);
  await input.press('Enter');
  await expect(quad(page, 'q2').locator('.card', { hasText: '学习英语' })).toContainText('#成长');
  await expect(input).toHaveValue('');
});

test('专注模式下拖到侧栏象限', async ({ page, isMobile }) => {
  await freshStart(page);
  await addViaDialog(page, '临时会议', 'q3');
  await quad(page, 'q3').locator('.quad-title').click();
  await expect(page.locator('.matrix.is-focused')).toBeVisible();
  await expect(page.locator('.rail-zone')).toHaveCount(3);
  await drag(page, '临时会议', '.rail-zone.q-q4', isMobile);
  await expect(page.locator('.rail-zone.q-q4 .rail-count')).toHaveText('1');
  await page.keyboard.press('Escape');
  await expect(page.locator('.matrix.is-focused')).toHaveCount(0);
  await expect(quad(page, 'q4').locator('.card', { hasText: '临时会议' })).toBeVisible();
});

test('搜索与标签筛选', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('group', { name: '按标签筛选' }).getByRole('button', { name: '#健康' }).click();
  await expect(page.locator('.card:not(.is-done)')).toHaveCount(2);
  await page.getByRole('group', { name: '按标签筛选' }).getByRole('button', { name: '全部' }).click();
  await expect(page.locator('.card:not(.is-done)').first()).toBeVisible();
  expect(await page.locator('.card:not(.is-done)').count()).toBeGreaterThan(2);
});

test('自定义象限颜色并保存', async ({ page }) => {
  await freshStart(page);
  const codeBg = () => quad(page, 'q2').locator('.quad-code').evaluate((el) => getComputedStyle(el).backgroundColor);
  const before = await codeBg();
  await page.getByRole('button', { name: '设置' }).first().click();
  await page.locator('#set-color-q2').fill('#1f9d63');
  await expect.poll(codeBg).not.toBe(before);
  // 选预设配色
  await page.getByRole('radio', { name: '冷色' }).click();
  await expect(page.getByRole('radio', { name: '冷色' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  const custom = await codeBg();
  await page.reload();
  expect(await codeBg()).toBe(custom);
  // 恢复默认
  await page.getByRole('button', { name: '设置' }).first().click();
  await page.getByRole('button', { name: '全部恢复默认配色' }).click();
  await expect(page.getByRole('radio', { name: '默认' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  expect(await codeBg()).toBe(before);
});
