// 电脑/iOS 版本的测试：油猴脚本和 Chrome 扩展都由 web/build.mjs 生成，这里检查生成物能用。
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const ext = path.join(dist, 'extension');
const read = (p) => fs.readFileSync(p, 'utf8');

before(() => {
  execFileSync(process.execPath, [path.join(root, 'web/build.mjs')], { stdio: 'ignore' });
});

function page(html, url = 'https://antigravity.google.com/') {
  return new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, { runScripts: 'outside-only', url });
}
const settle = () => new Promise((r) => setTimeout(r, 0));

test('油猴脚本：头部信息正确，两个网址都匹配，iframe 里也运行', () => {
  const js = read(path.join(dist, 'antigravity-zh.user.js'));
  const dict = JSON.parse(read(path.join(root, 'i18n/zh-CN.json')));
  const gradle = read(path.join(root, 'android/app/build.gradle.kts'));
  const appVersion = /versionName = "([^"]+)"/.exec(gradle)[1];
  assert.match(js, new RegExp(`// @version\\s+${appVersion.replace(/\./g, '\\.')}\\.${dict.revision}\\n`));
  assert.match(js, /@match\s+https:\/\/antigravity\.google\.com\/\*/);
  assert.match(js, /@match\s+https:\/\/antigravity\.static\.usercontent\.goog\/\*/);
  assert.match(js, /@run-at\s+document-start/);
  assert.doesNotMatch(js, /@noframes/);
});

test('油猴脚本：页面翻译成中文，菜单能复制未翻译的词条', async () => {
  const dom = page('<button>New conversation</button><span>Frobnicate the widgets</span>');
  const w = dom.window;
  const menu = [];
  let clip = null;
  w.GM_registerMenuCommand = (name, fn) => menu.push({ name, fn });
  w.GM_setClipboard = (t) => { clip = t; };
  w.alert = () => {};
  w.eval(read(path.join(dist, 'antigravity-zh.user.js')));
  assert.equal(w.document.querySelector('button').textContent, '新建对话');
  assert.equal(menu.length, 1);
  assert.equal(menu[0].name, '复制未翻译的词条');
  menu[0].fn();
  assert.ok(JSON.parse(clip).includes('Frobnicate the widgets'));
});

test('油猴脚本：没有菜单功能的环境（iOS 的 Userscripts）也能正常翻译', () => {
  const dom = page('<button>Accept all</button>');
  dom.window.eval(read(path.join(dist, 'antigravity-zh.user.js')));
  assert.equal(dom.window.document.querySelector('button').textContent, '全部接受');
});

test('扩展：manifest 设置正确，用到的文件都在', () => {
  const m = JSON.parse(read(path.join(ext, 'manifest.json')));
  assert.equal(m.manifest_version, 3);
  assert.match(m.version, /^\d+(\.\d+){1,3}$/);
  const cs = m.content_scripts[0];
  assert.deepEqual(cs.matches, ['https://antigravity.google.com/*', 'https://antigravity.static.usercontent.goog/*']);
  assert.equal(cs.all_frames, true, '远程控制界面在 iframe 里，必须所有框架都注入');
  assert.equal(cs.run_at, 'document_start');
  const files = [...cs.js, m.background.service_worker, m.action.default_popup, ...Object.values(m.icons)];
  for (const f of files) assert.ok(fs.existsSync(path.join(ext, f)), `缺少 ${f}`);
  assert.ok(fs.existsSync(path.join(dist, 'antigravity-zh-extension.zip')));
});

function loadExtension(dom, storage) {
  const w = dom.window;
  const listeners = [];
  w.chrome = {
    runtime: { lastError: undefined },
    storage: {
      local: { get: (keys, cb) => setTimeout(() => cb({ ...storage }), 0) },
      onChanged: { addListener: (fn) => listeners.push(fn) },
    },
  };
  for (const f of ['translator.js', 'dict.js', 'content.js']) w.eval(read(path.join(ext, f)));
  return listeners;
}

test('扩展：默认开启，翻译页面', async () => {
  const dom = page('<button>Reject all</button>');
  loadExtension(dom, {});
  await settle();
  assert.equal(dom.window.document.querySelector('button').textContent, '全部拒绝');
});

test('扩展：在远程控制界面的网址上也会运行', async () => {
  const dom = page('<button>Stop generating</button>', 'https://antigravity.static.usercontent.goog/web/latest/?iframe=true');
  loadExtension(dom, {});
  await settle();
  assert.equal(dom.window.document.querySelector('button').textContent, '停止生成');
});

test('扩展：关掉中文后不翻译', async () => {
  const dom = page('<button>Reject all</button>');
  loadExtension(dom, { enabled: false });
  await settle();
  assert.equal(dom.window.document.querySelector('button').textContent, 'Reject all');
});

test('扩展：用后台下载的新词典，并且能在打开的页面上立即换上', async () => {
  const bundled = JSON.parse(read(path.join(root, 'i18n/zh-CN.json')));
  const newer = { ...bundled, revision: bundled.revision + 1, strings: { ...bundled.strings, Frobnicate: '摆弄' } };
  const dom = page('<span id="a">Frobnicate</span><span id="b">Quux</span>');
  const listeners = loadExtension(dom, { dict: newer });
  await settle();
  assert.equal(dom.window.document.querySelector('#a').textContent, '摆弄');
  const newest = { ...newer, revision: newer.revision + 1, strings: { ...newer.strings, Quux: '库克斯' } };
  listeners.forEach((fn) => fn({ dict: { newValue: newest } }, 'local'));
  assert.equal(dom.window.document.querySelector('#b').textContent, '库克斯');
});
