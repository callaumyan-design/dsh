// End-to-end smoke test against a running server and scripts/mock-ai.mjs.
//   node scripts/e2e.cjs http://localhost:3100 http://127.0.0.1:3199 ./screenshots
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const APP = process.argv[2] || 'http://localhost:3100';
const MOCK = process.argv[3] || 'http://127.0.0.1:3199';
const OUT = path.resolve(process.argv[4] || 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

const step = (s) => console.log(`\n▶ ${s}`);
const openPages = [];
const ok = (s) => console.log(`  ✓ ${s}`);

async function addProvider(page, presetLabel, { key, url, expectModel, testModel }) {
  const dlg = page.getByRole('dialog').first();
  await dlg.getByRole('button', { name: '添加服务商' }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: new RegExp(presetLabel) }).click();
  await dlg.getByPlaceholder('sk-...').fill(key);
  await dlg.getByPlaceholder('https://api.example.com/v1').fill(url);
  await dlg.getByRole('button', { name: '保存', exact: true }).click();
  await dlg.getByText(/已保存密钥/).waitFor();
  await dlg.getByRole('button', { name: '获取模型' }).click();
  await dlg.locator(`span[title="${expectModel}"]`).waitFor({ timeout: 15000 });
  ok(`${presetLabel}: models fetched`);
  if (testModel) await dlg.locator('select').filter({ hasText: '自动选择测试模型' }).selectOption(testModel);
  await dlg.getByRole('button', { name: '测试连接' }).click();
  await dlg.getByText(/连接成功/).waitFor({ timeout: 15000 });
  ok(`${presetLabel}: connection test passed`);
}

async function pickModel(page, model) {
  // The model picker sits in the composer, the last chevron button in the main pane.
  await page.locator('main button').filter({ has: page.locator('svg.lucide-chevron-down') }).last().click();
  await page.getByPlaceholder(/搜索模型|Search models/).fill(model);
  await page.locator('div[role="button"]').first().click();
}

async function waitIdle(page) {
  await page.waitForTimeout(150);
  await page.waitForFunction(() => !document.querySelector('[aria-label="停止生成"],[aria-label="Stop"]'), null, { timeout: 20000 });
}

async function send(page, text) {
  const box = page.locator('textarea').last();
  await box.fill(text);
  await box.press('Enter');
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctxA = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  const a = await ctxA.newPage();
  openPages.push(a);
  a.on('pageerror', (e) => errors.push(`A pageerror: ${e.message}`));
  a.on('console', (m) => m.type() === 'error' && errors.push(`A console: ${m.text()}`));

  step('First run: create admin');
  await a.goto(APP);
  await a.getByText('创建管理员账户').waitFor();
  await a.screenshot({ path: path.join(OUT, '01-setup.png') });
  await a.getByPlaceholder('用户名').fill('admin');
  await a.getByPlaceholder('密码（至少 6 位）').fill('secret123');
  await a.getByPlaceholder('确认密码').fill('secret123');
  await a.getByRole('button', { name: '创建并进入' }).click();
  await a.getByText('先连接一个 AI 服务').waitFor();
  ok('admin created, welcome screen shown');
  await a.screenshot({ path: path.join(OUT, '02-welcome-empty.png') });

  step('Add providers (OpenAI-compatible, Anthropic-compatible, Gemini-compatible)');
  await a.getByRole('button', { name: '添加服务商' }).first().click();
  await a.getByText('模型服务').first().waitFor();
  await addProvider(a, '自定义（OpenAI 兼容）', { key: 'sk-mock', url: `${MOCK}/v1`, expectModel: 'mock-gpt', testModel: 'mock-gpt' });
  await a.screenshot({ path: path.join(OUT, '03-provider-settings.png') });
  await addProvider(a, '自定义（Anthropic 兼容）', { key: 'sk-ant-mock', url: `${MOCK}/anthropic/v1`, expectModel: 'claude-mock-5-5' });
  await addProvider(a, '自定义（Gemini 兼容）', { key: 'gm-mock', url: `${MOCK}/gemini/v1beta`, expectModel: 'gemini-mock-2.5-flash' });
  await a.keyboard.press('Escape');
  await a.waitForTimeout(300);

  step('Chat with OpenAI-compatible model (streaming, markdown, code, table, math)');
  await pickModel(a, 'mock-gpt');
  await send(a, '你好，介绍一下你自己');
  await a.getByText('Hello from mock-gpt').waitFor({ timeout: 15000 });
  await a.locator('.code-block').first().waitFor();
  await a.locator('.md table').first().waitFor();
  await a.locator('.katex').first().waitFor();
  await waitIdle(a);
  ok('reply rendered with code block, table and KaTeX');
  await a.waitForFunction(() => document.body.innerText.includes('Mock Chat Title'), null, { timeout: 15000 });
  ok('auto title generated');
  await a.locator('header').getByRole('button', { name: '更多' }).click();
  await a.getByRole('button', { name: '重命名' }).click();
  await a.getByRole('dialog').last().locator('input').fill('E2E Main');
  await a.getByRole('dialog').last().getByRole('button', { name: '保存' }).click();
  await a.locator('aside').getByText('E2E Main').waitFor();
  ok('conversation renamed');

  step('Reasoning model (reasoning_content) and <think> tag model');
  await pickModel(a, 'mock-reasoner');
  await send(a, 'Second question');
  await a.getByText(/已思考/).first().waitFor({ timeout: 15000 });
  ok('reasoning block shown');
  await waitIdle(a);
  await pickModel(a, 'mock-think-tag');
  await send(a, 'Third question');
  await a.getByText('Hello from mock-think-tag').waitFor({ timeout: 15000 });
  const leaked = await a.locator('.md').filter({ hasText: '<think>' }).count();
  if (leaked) throw new Error('<think> tag leaked into content');
  ok('<think> content split into reasoning');
  await waitIdle(a);

  step('Claude (Anthropic) and Gemini adapters');
  await pickModel(a, 'claude-mock-5-5');
  await send(a, 'Hi Claude');
  await a.getByText('Hello from claude-mock-5-5').waitFor({ timeout: 15000 });
  await waitIdle(a);
  ok('Anthropic streaming works');
  await pickModel(a, 'gemini-mock-2.5-flash');
  await send(a, 'Hi Gemini');
  await a.getByText('Hello from gemini-mock-2.5-flash').waitFor({ timeout: 15000 });
  await waitIdle(a);
  ok('Gemini streaming works');

  step('Regenerate creates a second version');
  await a.getByRole('button', { name: '重新生成' }).last().click();
  await a.getByText('2/2').waitFor({ timeout: 15000 });
  ok('version switcher shows 2/2');
  await a.waitForTimeout(800);
  await a.screenshot({ path: path.join(OUT, '04-chat-desktop-light.png') });

  step('Error surface');
  await pickModel(a, 'mock-error');
  await send(a, 'This will fail');
  await a.getByText(/intentionally broken/).waitFor({ timeout: 15000 });
  ok('provider error displayed with retry');

  step('Image attachment');
  await waitIdle(a);
  await pickModel(a, 'mock-gpt');
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAKElEQVR42mNk+M9Qz0AEYBxVSF+FjIyM/xkYGBj+MzAwMIzaMGoDAwMAkmQF/2N0FvQAAAAASUVORK5CYII=',
    'base64',
  );
  await a.locator('input[type="file"]').first().setInputFiles({ name: 'dot.png', mimeType: 'image/png', buffer: png });
  await a.locator('textarea').last().fill('What is in this image?');
  await a.waitForTimeout(300);
  await a.locator('textarea').last().press('Enter');
  await a.locator('img[alt="dot.png"]').first().waitFor({ timeout: 10000 });
  await a.getByText('You said: "What is in this image?"').waitFor({ timeout: 15000 });
  await waitIdle(a);
  const log = await (await fetch(`${MOCK}/__log`)).json();
  const last = log.filter((x) => x.api === 'openai').pop();
  if (!last || last.images !== 1) throw new Error(`expected 1 image part in the request, got ${last && last.images}`);
  ok('image sent with the message and reply received');

  step('Full-text search, prompt library, ChatGPT import');
  await a.getByPlaceholder('搜索对话…').fill('image');
  await a.getByText('消息内容匹配').waitFor({ timeout: 10000 }).catch(() => {});
  await a.getByPlaceholder('搜索对话…').fill('');
  await a.keyboard.press('Control+,');
  const settings = a.getByRole('dialog').first();
  await settings.getByRole('button', { name: '提示词库' }).click();
  await settings.getByRole('button', { name: '导入内置提示词' }).click();
  await settings.getByText('中英互译', { exact: true }).waitFor();
  ok('built-in prompts imported');
  await settings.getByRole('button', { name: '数据管理' }).click();
  const chatgpt = [
    {
      title: 'Imported from ChatGPT',
      create_time: Date.now() / 1000 - 86400 * 3,
      current_node: 'n3',
      mapping: {
        n1: { id: 'n1', parent: null, message: null },
        n2: { id: 'n2', parent: 'n1', message: { author: { role: 'user' }, create_time: Date.now() / 1000 - 86400 * 3, content: { content_type: 'text', parts: ['How tall is Everest?'] } } },
        n3: { id: 'n3', parent: 'n2', message: { author: { role: 'assistant' }, create_time: Date.now() / 1000 - 86400 * 3 + 5, metadata: { model_slug: 'gpt-4o' }, content: { content_type: 'text', parts: ['About 8,849 metres.'] } } },
      },
    },
  ];
  await settings.locator('input[type="file"]').setInputFiles({ name: 'conversations.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(chatgpt)) });
  await a.getByRole('dialog').last().getByRole('button', { name: '导入数据' }).click();
  await a.getByText(/已导入 1 个对话/).waitFor({ timeout: 15000 });
  await a.keyboard.press('Escape');
  await a.getByText('Imported from ChatGPT').click();
  await a.getByText('About 8,849 metres.').waitFor({ timeout: 15000 });
  ok('ChatGPT export imported and readable');

  step('Multi-model: one question answered by three models in parallel');
  await a.getByRole('button', { name: '新对话' }).first().click();
  await pickModel(a, 'mock-gpt');
  await a.getByRole('button', { name: '多模型同时回答' }).click();
  await a.locator('label').filter({ hasText: 'Claude Mock' }).locator('input').check();
  await a.locator('label').filter({ hasText: 'Gemini Mock' }).locator('input').check();
  await a.keyboard.press('Escape');
  await a.getByText('同时询问').waitFor();
  await send(a, 'Compare yourselves');
  await waitIdle(a);
  const tabs = a.locator('[data-model-tabs] button');
  if ((await tabs.count()) !== 3) throw new Error(`expected 3 model tabs, got ${await tabs.count()}`);
  await a.getByText('Hello from mock-gpt! You said: "Compare yourselves"').waitFor();
  await tabs.filter({ hasText: 'claude-mock-5-5' }).click();
  await a.getByText('Hello from claude-mock-5-5! You said: "Compare yourselves"').waitFor();
  await a.screenshot({ path: path.join(OUT, '09-multi-model.png') });
  ok('three answers streamed; tabs switch between them');
  await a.reload();
  await a.locator('[data-model-tabs] button').first().waitFor({ timeout: 15000 });
  await a.getByText('Hello from claude-mock-5-5! You said: "Compare yourselves"').waitFor({ timeout: 15000 });
  ok('selected answer and tabs persist after reload');
  await a.locator('aside').getByText('E2E Main').click();

  step('Web search: Gemini grounding, Qwen enable_search, Claude web_search tool');
  await a.evaluate(async (mock) => {
    const mk = (id, presetId, name, type, baseUrl, apiKey, model) => ({
      kind: 'provider',
      id,
      data: { id, presetId, name, type, baseUrl, apiKey, models: [{ id: model }], enabled: true, mode: 'proxy', createdAt: Date.now() },
    });
    await fetch('/api/sync/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${localStorage.getItem('omnichat.token')}` },
      body: JSON.stringify({
        ops: [
          mk('qwen-mock', 'qwen', 'Qwen Mock', 'openai', `${mock}/v1`, 'sk-mock', 'qwen-plus'),
          mk('claude-official-mock', 'anthropic', 'Claude Official Mock', 'anthropic', `${mock}/anthropic/v1`, 'sk-ant-mock', 'claude-opus-5-5'),
        ],
      }),
    });
  }, MOCK);
  await a.reload();
  await a.waitForSelector('aside');
  for (const model of ['gemini-mock-2.5-flash', 'qwen-plus', 'claude-opus-5-5']) {
    await a.getByRole('button', { name: '新对话' }).first().click();
    await pickModel(a, model);
    await a.getByRole('button', { name: /联网/ }).click();
    await send(a, `Search the web please (${model})`);
    await a.getByText(/参考来源（2）/).waitFor({ timeout: 15000 });
    await waitIdle(a);
    await a.locator('a[href="https://en.wikipedia.org/wiki/Chatbot"]').first().waitFor();
    ok(`${model}: search enabled and 2 sources shown`);
  }
  const searchLog = (await (await fetch(`${MOCK}/__log`)).json()).slice(-6);
  if (searchLog.filter((x) => x.search).length < 3) throw new Error('mock did not receive search-enabled requests');
  await a.screenshot({ path: path.join(OUT, '10-web-search.png') });
  await a.locator('aside').getByText('E2E Main').click();

  step('OpenAI Responses API: reasoning summary, web search, summary fallback');
  await a.evaluate(async (mock) => {
    await fetch('/api/sync/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${localStorage.getItem('omnichat.token')}` },
      body: JSON.stringify({
        ops: [
          {
            kind: 'provider',
            id: 'responses-mock',
            data: {
              presetId: 'openai', name: 'OpenAI Responses Mock', type: 'openai', baseUrl: `${mock}/v1`, apiKey: 'sk-mock', useResponsesApi: true,
              models: [{ id: 'gpt-5-mock' }, { id: 'gpt-5-nosummary' }], enabled: true, mode: 'proxy', createdAt: Date.now(),
            },
          },
        ],
      }),
    });
  }, MOCK);
  await a.reload();
  await a.waitForSelector('aside');
  await a.getByRole('button', { name: '新对话' }).first().click();
  await pickModel(a, 'gpt-5-mock');
  await a.getByRole('button', { name: /联网/ }).click();
  await send(a, 'Use the responses API');
  await a.getByText('Hello from gpt-5-mock').waitFor({ timeout: 15000 });
  await waitIdle(a);
  await a.getByText(/已思考/).first().waitFor();
  await a.getByText(/参考来源（2）/).waitFor();
  ok('streamed text, reasoning summary and citations');
  await pickModel(a, 'gpt-5-nosummary');
  await send(a, 'Retry without summary');
  await a.getByText('Hello from gpt-5-nosummary').waitFor({ timeout: 15000 });
  await waitIdle(a);
  ok('falls back when reasoning summaries are not allowed');
  await a.locator('aside').getByText('E2E Main').click();

  step('Esc stops generation; replies can be edited');
  await pickModel(a, 'mock-reasoner');
  await send(a, 'Stop me early');
  await a.waitForSelector('[aria-label="停止生成"]');
  await a.keyboard.press('Escape');
  await a.getByText('已停止生成').last().waitFor({ timeout: 10000 });
  ok('Escape stopped the stream');
  await waitIdle(a);
  const lastReply = a.locator('main .group').last();
  await lastReply.hover();
  await lastReply.getByRole('button', { name: '更多' }).click();
  await a.locator('[data-popover]').getByRole('button', { name: '编辑', exact: true }).click();
  await a.locator('main textarea').first().fill('Edited reply text');
  await a.locator('main').getByRole('button', { name: '保存', exact: true }).click();
  await a.getByText('Edited reply text').waitFor();
  ok('assistant reply edited');

  step('Usage statistics');
  await a.keyboard.press('Control+,');
  await a.getByRole('dialog').getByRole('button', { name: '用量统计' }).click();
  await a.getByText('每日 Token 用量').waitFor();
  await a.getByRole('dialog').locator('td').filter({ hasText: 'gpt-5-mock' }).first().waitFor({ timeout: 10000 });
  const bars = await a.locator('.usage-viz path').count();
  if (!bars) throw new Error('usage chart has no bars');
  ok(`usage tab shows per-model totals and ${bars} bar segment(s)`);
  await a.keyboard.press('Escape');

  step('Projects: shared instructions and files, moving chats in and out');
  await a.locator('aside').getByRole('button', { name: '新建项目' }).first().click();
  const editor = a.getByRole('dialog').last();
  await editor.getByPlaceholder(/毕业论文、/).fill('E2E Project');
  await editor.locator('textarea').fill('PROJECT-RULE: answer like a pirate.');
  await editor.getByRole('button', { name: '创建项目' }).click();
  await a.locator('main h1').filter({ hasText: 'E2E Project' }).waitFor();
  await a.locator('main input[type="file"]').last().setInputFiles({ name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Notes\nPROJECT-FILE-CONTENT') });
  await a.locator('main').getByText('notes.md').waitFor();
  ok('project created with instructions and a knowledge file');
  await a.screenshot({ path: path.join(OUT, '04b-project.png') });
  await pickModel(a, 'mock-gpt');
  await send(a, 'Question inside the project');
  await a.getByText('You said: "Question inside the project"').waitFor({ timeout: 15000 });
  await waitIdle(a);
  const projectReq = (await (await fetch(`${MOCK}/__log`)).json()).filter((x) => x.api === 'openai' && x.system).pop();
  if (!projectReq?.system?.includes('PROJECT-RULE') || !projectReq.system.includes('PROJECT-FILE-CONTENT')) {
    throw new Error(`project instructions/files missing from the system prompt: ${projectReq && projectReq.system}`);
  }
  ok('project instructions and file content sent as the system prompt');
  await a.locator('header').getByRole('button', { name: 'E2E Project' }).waitFor();
  await a.locator('header').getByRole('button', { name: 'E2E Project' }).click();
  await a.locator('main').getByRole('button', { name: /Mock Chat Title|Question inside the project/ }).first().waitFor({ timeout: 15000 });
  ok('chat listed on the project page, breadcrumb links back');
  const mainItem = a.locator('aside .group').filter({ hasText: 'E2E Main' });
  await mainItem.hover();
  await mainItem.getByRole('button', { name: '更多' }).click();
  await a.locator('[data-popover]').getByRole('button', { name: '移到项目…' }).click();
  await a.getByRole('dialog').last().getByRole('button', { name: 'E2E Project' }).click();
  await a.getByText('已移到「E2E Project」').waitFor();
  await a.locator('main').getByRole('button', { name: /E2E Main/ }).waitFor();
  await a.locator('main').getByRole('button', { name: /E2E Main/ }).click();
  await a.locator('header').getByRole('button', { name: '更多' }).click();
  await a.locator('[data-popover]').getByRole('button', { name: '移到项目…' }).click();
  await a.getByRole('dialog').last().getByRole('button', { name: '移出项目' }).click();
  await a.getByText('已移出项目').waitFor();
  ok('chat moved into the project and back out');

  step('Second device: sign in on a phone-sized browser and see the same history');
  await a.waitForTimeout(1500); // let the outbox flush
  const ctxB = await browser.newContext({ locale: 'en-US', viewport: { width: 390, height: 844 }, colorScheme: 'dark', isMobile: true, hasTouch: true });
  const b = await ctxB.newPage();
  openPages.push(b);
  b.on('pageerror', (e) => errors.push(`B pageerror: ${e.message}`));
  await b.goto(APP);
  await b.getByPlaceholder('Username').fill('admin');
  await b.getByPlaceholder(/Password/).fill('secret123');
  await b.getByRole('button', { name: 'Sign in' }).click();
  await b.getByText(/Good (morning|afternoon|evening)|Up late/).waitFor();
  await b.screenshot({ path: path.join(OUT, '05-mobile-welcome-dark.png') });
  await b.getByRole('button', { name: 'Open sidebar' }).first().click();
  await b.locator('aside').getByText('E2E Project').waitFor();
  ok('project synced to second device');
  await b.getByText('E2E Main').click();
  await b.getByText('Hello from mock-gpt').first().waitFor({ timeout: 15000 });
  ok('conversation and messages synced to second device');
  await b.waitForTimeout(500);
  await b.screenshot({ path: path.join(OUT, '06-mobile-chat-dark.png') });

  step('Reply from the phone appears on the desktop');
  await pickModel(b, 'mock-gpt');
  await b.locator('textarea').last().fill('Sent from my phone');
  await b.getByRole('button', { name: 'Send' }).click();
  await b.getByText('Hello from mock-gpt! You said: "Sent from my phone"').waitFor({ timeout: 15000 });
  await b.waitForTimeout(1500);
  await a.evaluate(() => window.dispatchEvent(new Event('focus')));
  await a.getByText('Sent from my phone').first().waitFor({ timeout: 25000 });
  ok('desktop received the phone message');

  step('Dark desktop + settings screenshots');
  await a.evaluate(() => window.dispatchEvent(new Event('focus')));
  await ctxA.close();
  const ctxC = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const c = await ctxC.newPage();
  await c.goto(APP);
  await c.getByPlaceholder('用户名').fill('admin');
  await c.getByPlaceholder('密码（至少 6 位）').fill('secret123');
  await c.getByRole('button', { name: '登录' }).click();
  await c.getByText('E2E Main').click();
  await c.getByText('Sent from my phone').first().waitFor({ timeout: 15000 });
  await c.waitForTimeout(600);
  await c.screenshot({ path: path.join(OUT, '07-chat-desktop-dark.png') });
  await c.keyboard.press('Control+,');
  await c.getByText('模型服务').first().waitFor();
  await c.waitForTimeout(300);
  await c.screenshot({ path: path.join(OUT, '08-settings-dark.png') });

  await browser.close();
  if (errors.length) {
    console.log('\nBrowser errors:\n' + errors.join('\n'));
  }
  console.log('\nAll e2e checks passed.');
})().catch(async (err) => {
  console.error('\nE2E FAILED:', err.message.split('\n').slice(0, 6).join('\n'));
  for (const [i, p] of openPages.entries()) {
    try {
      await p.screenshot({ path: path.join(OUT, `fail-${i}.png`) });
      console.error(`--- page ${i} text ---\n` + (await p.evaluate(() => document.body.innerText)).slice(0, 3000));
    } catch {}
  }
  process.exit(1);
});
