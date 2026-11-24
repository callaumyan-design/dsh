// 翻译脚本的测试：在 jsdom 里搭一个假页面，按应用的方式注入脚本，看界面文字有没有换对、该跳过的有没有跳过。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const here = path.dirname(fileURLToPath(import.meta.url));
const i18n = path.join(here, '..', 'i18n');
const translatorJs = fs.readFileSync(path.join(i18n, 'translator.js'), 'utf8');
const dict = JSON.parse(fs.readFileSync(path.join(i18n, 'zh-CN.json'), 'utf8'));

// 和应用里 Translator.buildScript() 拼出来的一样（shell.js 依赖页面布局，在浏览器测试里测）
function install(html, d = dict) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, {
    runScripts: 'outside-only',
    url: 'https://antigravity.google.com/',
  });
  const posted = [];
  dom.window.AgBridge = { postMessage: (s) => posted.push(JSON.parse(s)) };
  dom.window.eval(`${translatorJs}\n__agInstallTranslator(window, {"revision": ${d.revision}}, ${JSON.stringify(d)});`);
  return { dom, window: dom.window, document: dom.window.document, posted };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

// 数正则最外层（不在括号、方括号里）的 | 有几个
function topLevelAlternations(source) {
  let depth = 0;
  let inClass = false;
  let count = 0;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '\\') { i++; continue; }
    if (inClass) { if (c === ']') inClass = false; continue; }
    if (c === '[') inClass = true;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === '|' && depth === 0) count++;
  }
  return count;
}
const text = (doc, sel) => doc.querySelector(sel).textContent;

test('词典格式正确：版本号、对照表、规则都能用', () => {
  assert.equal(dict.schema, 1);
  assert.ok(Number.isInteger(dict.revision) && dict.revision > 0);
  assert.ok(Object.keys(dict.strings).length > 500);
  for (const [k, v] of Object.entries(dict.strings)) {
    assert.equal(typeof v, 'string', k);
    assert.ok(v.trim().length > 0, `空翻译：${k}`);
    assert.notEqual(k.trim(), '', '空键');
  }
  for (const p of dict.patterns) {
    const re = new RegExp(p.re);
    assert.ok(p.re.startsWith('^') && p.re.endsWith('$'), `规则要整段匹配：${p.re}`);
    assert.equal(topLevelAlternations(p.re), 0, `规则最外层有没加括号的 |，会匹配到不该匹配的文字：${p.re}`);
    const groups = new RegExp(`${re.source}|`).exec('').length - 1;
    for (const m of p.to.matchAll(/\{(\d)\}|\$(\d)/g)) {
      assert.ok(Number(m[1] ?? m[2]) <= groups, `规则 ${p.re} 引用了不存在的分组`);
    }
  }
});

test('整段对得上的界面文字换成中文，前后空格保留', () => {
  const { document } = install('<button id="a"> New conversation </button><span id="b">Settings</span><div id="c">Accept all</div>');
  assert.equal(text(document, '#a'), ' 新建对话 ');
  assert.equal(text(document, '#b'), '设置');
  assert.equal(text(document, '#c'), '全部接受');
});

test('大小写不同、结尾带标点的写法也能对上', () => {
  const { document } = install('<b id="a">New Conversation</b><b id="b">Search...</b><b id="c">Name:</b><b id="d">Loading…</b><b id="e">Something went wrong.</b>');
  assert.equal(text(document, '#a'), '新建对话');
  assert.equal(text(document, '#b'), '搜索…');
  assert.equal(text(document, '#c'), '名称：');
  assert.equal(text(document, '#d'), '正在加载…');
  assert.equal(text(document, '#e'), '出了点问题。');
});

test('只有一部分对得上的句子不动', () => {
  const { document } = install('<p id="a">Settings for this project are saved</p><span id="b">Settings and frobnication</span>');
  assert.equal(text(document, '#a'), 'Settings for this project are saved');
  assert.equal(text(document, '#b'), 'Settings and frobnication');
});

test('通用组合规则只在每一部分都翻得出来时才用', () => {
  const { window } = install('');
  const t = (s) => window.__agI18n.translate(s);
  assert.equal(t('Hide Sidebar'), '隐藏侧边栏');
  assert.equal(t('Settings (3)'), '设置（3）');
  assert.equal(t('Status: Running'), '状态：运行中');
  assert.equal(t('Skills and Rules'), '技能和规则');
  assert.equal(t('Hide my-panel'), null, '名称部分翻不出来，整条不动');
  assert.equal(t('Frobnicator (3)'), null);
  assert.equal(t('Foo: Bar'), null);
  // 不要求全部翻出来的具体规则照常工作
  assert.equal(t('Edited main.py'), '已编辑 main.py');
  assert.equal(t('+3 attachments'), '另外 3 个附件');
  assert.equal(t('Daily at 9:00 AM'), '每天 上午 9:00');
});

test('带数字、时间的规则', () => {
  const { window } = install('');
  const t = (s) => window.__agI18n.translate(s);
  assert.equal(t('5 minutes ago'), '5 分钟前');
  assert.equal(t('1 hr ago'), '1 小时前');
  assert.equal(t('a minute ago'), '1 分钟前');
  assert.equal(t('Worked for 2m 31s'), '工作了 2 分 31 秒');
  assert.equal(t('Thought for 12s'), '思考了 12 秒');
  assert.equal(t('Updated 3 days ago'), '3 天前更新');
  assert.equal(t('Nov 24'), '11月24日');
  assert.equal(t('November 24, 2026'), '2026年11月24日');
  assert.equal(t('Monday, November 24, 2026'), '2026年11月24日 星期一');
  assert.equal(t('Yesterday at 3:45 PM'), '昨天 下午 3:45');
  assert.equal(t('3 files changed'), '已更改 3 个文件');
  assert.equal(t('1 file'), '1 个文件');
  assert.equal(t('12 conversations'), '12 个对话');
  assert.equal(t('Step 1/3: Creating environment... (0s / 1-3 min)'), '第 1/3 步：正在创建环境…（0 秒 / 1–3 分钟）');
  assert.equal(t('Delete conversation?'), '删除对话？');
  assert.equal(t('Delete my-repo?'), '删除my-repo？');
  assert.equal(t('Last active 2h ago'), '上次活跃：2 小时前');
});

test('代码、编辑器、输入框、对话正文、图标字体里的文字不翻译', () => {
  const { document } = install(`
    <pre id="pre"><span>Cancel</span></pre>
    <code id="code">Done</code>
    <div contenteditable="true" id="edit"><p>Continue</p></div>
    <textarea id="ta">Send</textarea>
    <span class="material-symbols-outlined" id="icon">settings</span>
    <mat-icon id="mat">Close</mat-icon>
    <div class="rendered-markdown" id="md"><p>Done</p><ul><li>Accept</li></ul></div>
    <span translate="no" id="no">Settings</span>
    <span id="lower">settings</span>
  `);
  assert.equal(text(document, '#pre'), 'Cancel');
  assert.equal(text(document, '#code'), 'Done');
  assert.equal(text(document, '#edit'), 'Continue');
  assert.equal(document.querySelector('#ta').value, 'Send');
  assert.equal(text(document, '#icon'), 'settings');
  assert.equal(text(document, '#mat'), 'Close');
  assert.equal(text(document, '#md'), 'DoneAccept');
  assert.equal(text(document, '#no'), 'Settings');
  assert.equal(text(document, '#lower'), 'settings', '全小写的单词可能是图标名，不按大小写放宽匹配');
});

test('Antigravity 的智能体回复、制品正文、你发的消息都不翻译', () => {
  const { document } = install(`
    <div data-testid="agent-response">
      <h6 id="said">Agent said</h6>
      <div data-markdown-root id="md"><div data-markdown-block-index="0"><h2>Overview</h2><p>Done</p></div></div>
      <button id="btn">Copy</button>
    </div>
    <div data-testid="user-message-content" id="user">Continue</div>
    <span class="google-symbols" id="icon">settings</span>
    <p class="m-0 max-w-prose text-sm" id="err">Network error</p>
  `);
  assert.equal(text(document, '#md'), 'OverviewDone');
  assert.equal(text(document, '#user'), 'Continue');
  assert.equal(text(document, '#icon'), 'settings');
  assert.equal(text(document, '#btn'), '复制', '回复旁边的按钮照常翻译');
  assert.equal(text(document, '#err'), '网络错误', 'Tailwind 的 max-w-prose 不是正文');
});

test('大量翻不出来的文字也处理得很快', () => {
  const words = ['alpha', 'Bravo', 'charlie and delta', 'Echo (fox)', 'Golf: hotel', 'India · juliet', 'Kilo / lima'];
  const html = Array.from({ length: 3000 }, (_, i) => `<span>${words[i % words.length]} ${i} and more text ${i % 13}</span>`).join('');
  const start = Date.now();
  const { document } = install(html);
  assert.ok(Date.now() - start < 5000, `用了 ${Date.now() - start} ms`);
  assert.equal(document.querySelectorAll('span').length, 3000);
});

test('占位提示、按钮提示、无障碍标签也翻译', () => {
  const { document } = install(`
    <input id="i" placeholder="Ask anything">
    <button id="b" title="Copy" aria-label="More actions">x</button>
    <input id="s" type="submit" value="Submit">
    <input id="t" type="text" value="Submit">
    <div contenteditable="true" id="e" aria-placeholder="Type a message"></div>
  `);
  assert.equal(document.querySelector('#i').getAttribute('placeholder'), '随便问点什么');
  assert.equal(document.querySelector('#b').getAttribute('title'), '复制');
  assert.equal(document.querySelector('#b').getAttribute('aria-label'), '更多操作');
  assert.equal(document.querySelector('#s').getAttribute('value'), '提交');
  assert.equal(document.querySelector('#t').getAttribute('value'), 'Submit', '文本框里的内容不改');
  assert.equal(document.querySelector('#e').getAttribute('aria-placeholder'), '输入消息');
});

test('页面后来加上、改掉的文字也会翻译', async () => {
  const { document } = install('<div id="root"></div><span id="s">Running</span>');
  const root = document.querySelector('#root');
  root.innerHTML = '<button>Reject</button><span>Thinking...</span>';
  const s = document.querySelector('#s');
  s.firstChild.nodeValue = 'Completed';
  const btn = document.createElement('button');
  btn.setAttribute('title', 'Delete');
  root.appendChild(btn);
  await settle();
  assert.equal(root.querySelector('button').textContent, '拒绝');
  assert.equal(root.querySelector('span').textContent, '思考中…');
  assert.equal(s.textContent, '已完成');
  assert.equal(btn.getAttribute('title'), '删除');
  // 网页再把同一个按钮改回英文，也会再翻一次
  root.querySelector('button').firstChild.nodeValue = 'Approve';
  btn.setAttribute('title', 'Copy');
  await settle();
  assert.equal(root.querySelector('button').textContent, '批准');
  assert.equal(btn.getAttribute('title'), '复制');
});

test('新加进对话正文里的文字照样跳过', async () => {
  const { document } = install('<div class="markdown-body" id="md"></div>');
  const md = document.querySelector('#md');
  md.innerHTML = '<p>Cancel</p>';
  md.appendChild(document.createTextNode('Done'));
  await settle();
  assert.equal(md.textContent, 'CancelDone');
});

test('互相指向的词条不会让页面来回改个不停', async () => {
  const d = { schema: 1, revision: 1, strings: { Alpha: 'Beta', Beta: 'Alpha' }, patterns: [] };
  const { document, window } = install('<span id="a">Alpha</span>', d);
  let mutations = 0;
  new window.MutationObserver((r) => { mutations += r.length; }).observe(document.body, { subtree: true, characterData: true });
  await settle();
  await settle();
  assert.equal(text(document, '#a'), 'Beta');
  assert.ok(mutations <= 1, `改了 ${mutations} 次`);
});

test('没翻译的界面文字会记下来发给应用，路径、版本号这类不记', async () => {
  const { document, window, posted } = install('<span>Frobnicate the widgets</span><span>src/main.ts</span><span>v1.2.3</span><span>toolPermission</span><span>12 MB</span>');
  const missing = window.__agI18n.missing();
  assert.ok(missing.includes('Frobnicate the widgets'));
  assert.ok(!missing.includes('src/main.ts'));
  assert.ok(!missing.includes('v1.2.3'));
  assert.ok(!missing.includes('toolPermission'));
  assert.ok(!missing.includes('12 MB'));
  await new Promise((r) => setTimeout(r, 2100));
  const items = posted.filter((m) => m.t === 'missing').flatMap((m) => m.items);
  assert.ok(items.includes('Frobnicate the widgets'));
  assert.ok(document.body.textContent.includes('Frobnicate'));
});

test('换新词典后，已经打开的页面立即更新', () => {
  const { document, window } = install('<span id="a">Frobnicate</span>');
  assert.equal(text(document, '#a'), 'Frobnicate');
  window.__agI18n.update({ ...dict, strings: { ...dict.strings, Frobnicate: '摆弄' } });
  assert.equal(text(document, '#a'), '摆弄');
});

test('重复注入不会装两份', () => {
  const { window } = install('<span>Cancel</span>');
  const first = window.__agI18n;
  window.eval(`__agInstallTranslator(window, {}, ${JSON.stringify(dict)});`);
  assert.equal(window.__agI18n, first);
});
