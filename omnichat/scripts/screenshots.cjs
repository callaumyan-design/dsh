// Seeds realistic demo data (backed by scripts/mock-ai.mjs) and captures README screenshots.
//   node scripts/screenshots.cjs http://localhost:3101 http://127.0.0.1:3199 docs/screenshots
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const APP = process.argv[2] || 'http://localhost:3101';
const MOCK = process.argv[3] || 'http://127.0.0.1:3199';
const OUT = path.resolve(process.argv[4] || 'docs/screenshots');
fs.mkdirSync(OUT, { recursive: true });

const now = Date.now();
const day = 86_400_000;
let seq = 0;
const id = (p) => `${p}-${++seq}-${Math.random().toString(36).slice(2, 8)}`;

const providers = [
  { presetId: 'deepseek', name: 'DeepSeek 深度求索', type: 'openai', baseUrl: `${MOCK}/v1`, apiKey: 'sk-mock', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { presetId: 'openai', name: 'OpenAI', type: 'openai', baseUrl: `${MOCK}/v1`, apiKey: 'sk-mock', models: ['gpt-5.1', 'gpt-5-mini', 'o3'] },
  { presetId: 'anthropic', name: 'Anthropic Claude', type: 'anthropic', baseUrl: `${MOCK}/anthropic/v1`, apiKey: 'sk-ant-mock', models: ['claude-opus-5-5', 'claude-sonnet-5-5'] },
  { presetId: 'gemini', name: 'Google Gemini', type: 'gemini', baseUrl: `${MOCK}/gemini/v1beta`, apiKey: 'gm-mock', models: ['gemini-2.5-pro', 'gemini-2.5-flash'] },
  { presetId: 'qwen', name: '阿里云百炼 · 通义千问', type: 'openai', baseUrl: `${MOCK}/v1`, apiKey: 'sk-mock', models: ['qwen3-max', 'qwen-plus'] },
  { presetId: 'zhipu', name: '智谱 GLM', type: 'openai', baseUrl: `${MOCK}/v1`, apiKey: 'sk-mock', models: ['glm-4.6'] },
].map((p, i) => ({ ...p, id: id('prov'), order: i, enabled: true, mode: 'proxy', createdAt: now - 1000 + i, models: p.models.map((m) => ({ id: m })) }));

const prompts = [
  ['🌐', '中英互译', '地道、准确的中英互译'],
  ['💻', '编程专家', '写代码、找 Bug、讲解原理'],
  ['✍️', '文字润色', '让文字更通顺、专业'],
  ['📝', '内容总结', '提炼长文、会议、论文要点'],
].map(([icon, name, description], i) => ({ id: id('prompt'), icon, name, description, systemPrompt: `${description}。`, createdAt: now + i, order: i }));

const pastChats = [
  ['周末杭州两日游行程', 0.1, false],
  ['Rust 所有权与借用讲解', 0.3, true],
  ['英文求职信润色', 1.2, false],
  ['React 性能优化清单', 3, false],
  ['家庭理财入门建议', 5, false],
  ['SQL 窗口函数示例', 12, false],
  ['论文摘要翻译', 40, false],
];

async function api(page, url, body) {
  return page.evaluate(
    async ([u, b]) => {
      const r = await fetch(u, {
        method: b ? 'POST' : 'GET',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${localStorage.getItem('omnichat.token')}` },
        body: b ? JSON.stringify(b) : undefined,
      });
      return r.json();
    },
    [url, body],
  );
}

async function waitIdle(page) {
  await page.waitForTimeout(200);
  await page.waitForFunction(() => !document.querySelector('[aria-label="停止生成"],[aria-label="Stop"]'), null, { timeout: 30000 });
}

async function login(ctx) {
  const page = await ctx.newPage();
  await page.goto(APP);
  await page.getByPlaceholder(/用户名|Username/).fill('Yan');
  await page.getByPlaceholder(/密码|Password/).first().fill('demo-pass-123');
  await page.getByRole('button', { name: /^(登录|Sign in)$/ }).click();
  await page.waitForSelector('aside');
  return page;
}

(async () => {
  const browser = await chromium.launch();

  // ---- seed ----
  const ctx = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 900 }, colorScheme: 'light', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(APP);
  await page.getByPlaceholder('用户名').fill('Yan');
  await page.getByPlaceholder('密码（至少 6 位）').fill('demo-pass-123');
  await page.getByPlaceholder('确认密码').fill('demo-pass-123');
  await page.getByRole('button', { name: '创建并进入' }).click();
  await page.waitForSelector('aside');

  const ops = [];
  for (const p of providers) ops.push({ kind: 'provider', id: p.id, data: p });
  for (const p of prompts) ops.push({ kind: 'prompt', id: p.id, data: p });
  const deepseek = providers[0];
  ops.push({
    kind: 'settings',
    id: 'user',
    data: {
      theme: 'system',
      accent: 'indigo',
      language: 'auto',
      fontSize: 'md',
      sendKey: 'enter',
      autoTitle: true,
      codeWrap: false,
      showUsage: true,
      renderMarkdownForUser: false,
      defaultProviderId: deepseek.id,
      defaultModel: 'deepseek-reasoner',
      favoriteModels: [`${providers[1].id}::gpt-5.1`, `${providers[2].id}::claude-opus-5-5`, `${deepseek.id}::deepseek-reasoner`],
    },
  });
  for (const [title, ageDays, pinned] of pastChats) {
    const cid = id('conv');
    const ts = now - ageDays * day;
    ops.push({ kind: 'conversation', id: cid, data: { id: cid, title, pinned, createdAt: ts, lastMessageAt: ts, titleGenerated: true, providerId: providers[1].id, model: 'gpt-5.1' } });
    ops.push({ kind: 'message', id: id('m'), data: { conversationId: cid, role: 'user', content: title, createdAt: ts } });
    ops.push({ kind: 'message', id: id('m'), data: { conversationId: cid, role: 'assistant', content: `关于「${title}」，以下是要点……`, createdAt: ts + 1, status: 'done', model: 'gpt-5.1', providerId: providers[1].id, providerName: 'OpenAI' } });
  }
  await api(page, '/api/sync/push', { ops });
  await page.reload();
  await page.waitForSelector('aside');
  await page.getByText('周末杭州两日游行程').waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'welcome.png') });

  // ---- a real streamed conversation (reasoning + code + table + math) ----
  await page.locator('textarea').last().fill('用 Python 写一个快速排序，并解释时间复杂度');
  await page.locator('textarea').last().press('Enter');
  await waitIdle(page);
  await page.waitForFunction(() => document.body.innerText.includes('快速排序与复杂度分析'), null, { timeout: 20000 });
  await page.mouse.move(10, 10);
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, 'chat-light.png') });

  await page.keyboard.press('Control+,');
  await page.getByText('模型服务').first().waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'settings.png') });
  await page.keyboard.press('Escape');

  // model picker
  await page.locator('header button').filter({ has: page.locator('svg.lucide-chevron-down') }).first().click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, 'model-picker.png') });
  await page.keyboard.press('Escape');
  const convUrl = page.url();
  await page.waitForTimeout(1500);

  // ---- dark desktop ----
  const dark = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const d = await login(dark);
  await d.goto(convUrl);
  await d.getByText('快速排序采用').waitFor({ timeout: 15000 });
  await d.waitForTimeout(800);
  await d.screenshot({ path: path.join(OUT, 'chat-dark.png') });

  // ---- phone ----
  const phone = await browser.newContext({ locale: 'zh-CN', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'light' });
  const m = await login(phone);
  await m.goto(convUrl);
  await m.getByText('快速排序采用').waitFor({ timeout: 15000 });
  await m.waitForTimeout(800);
  await m.screenshot({ path: path.join(OUT, 'mobile.png') });
  await m.getByRole('button', { name: '展开侧边栏' }).first().click();
  await m.waitForTimeout(400);
  await m.screenshot({ path: path.join(OUT, 'mobile-sidebar.png') });

  await browser.close();
  console.log('screenshots written to', OUT);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
