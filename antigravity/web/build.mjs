#!/usr/bin/env node
// 生成电脑和 iPhone/iPad 用的版本，翻译脚本和词典与安卓应用共用 antigravity/i18n/：
//   dist/antigravity-zh.user.js          油猴脚本（Tampermonkey / Violentmonkey / iOS 的 Userscripts）
//   dist/extension/                       Chrome / Edge 扩展（“加载已解压的扩展程序”用这个文件夹）
//   dist/antigravity-zh-extension.zip     上面那个文件夹的压缩包
// 用法：node web/build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const translatorJs = read('i18n/translator.js');
const dict = JSON.parse(read('i18n/zh-CN.json'));
const gradle = read('android/app/build.gradle.kts');
const appVersion = /versionName = "([^"]+)"/.exec(gradle)?.[1];
if (!appVersion) throw new Error('android/app/build.gradle.kts 里没找到 versionName');
// 版本号 = 应用版本 + 词典版本，只改词典也会让油猴脚本自动更新
const version = `${appVersion}.${dict.revision}`;
const matches = ['https://antigravity.google.com/*', 'https://antigravity.static.usercontent.goog/*'];
const rawBase = 'https://raw.githubusercontent.com/callaumyan-design/dsh/main/antigravity';
const dictJson = JSON.stringify(dict);

const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });

// ---------------------------------------------------------------- 油猴脚本

const userscript = `// ==UserScript==
// @name         反重力：Antigravity 中文界面
// @namespace    https://github.com/callaumyan-design/dsh
// @version      ${version}
// @description  把 Google Antigravity 网页版的界面翻译成中文，对话内容和代码保持原样。非官方，与 Google 无关。
${matches.map((m) => `// @match        ${m}`).join('\n')}
// @run-at       document-start
// @inject-into  content
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @homepageURL  https://github.com/callaumyan-design/dsh/tree/main/antigravity
// @updateURL    ${rawBase}/dist/antigravity-zh.user.js
// @downloadURL  ${rawBase}/dist/antigravity-zh.user.js
// ==/UserScript==

// 由 antigravity/web/build.mjs 生成，不要直接修改。
// 翻译脚本：antigravity/i18n/translator.js；词典：antigravity/i18n/zh-CN.json（第 ${dict.revision} 版）。
// 远程控制（连到你自己电脑）的对话界面是 antigravity.static.usercontent.goog 的 iframe，所以两个网址都要匹配。
(function () {
  'use strict';
${translatorJs}
  var DICT = ${dictJson};
  var api = __agInstallTranslator(window, { revision: DICT.revision }, DICT);
  if (api && typeof GM_registerMenuCommand === 'function') {
    var top = window.top === window;
    GM_registerMenuCommand(top ? '复制未翻译的词条' : '复制未翻译的词条（远程控制界面）', function () {
      var list = api.missing();
      var text = JSON.stringify(list);
      if (typeof GM_setClipboard === 'function') GM_setClipboard(text);
      else if (navigator.clipboard) navigator.clipboard.writeText(text);
      alert(list.length ? '已复制 ' + list.length + ' 条，发给开发者就能补进词典' : '目前没有记录到没翻译的英文');
    });
  }
})();
`;
fs.writeFileSync(path.join(dist, 'antigravity-zh.user.js'), userscript);

// ---------------------------------------------------------------- Chrome / Edge 扩展

const ext = path.join(dist, 'extension');
fs.rmSync(ext, { recursive: true, force: true });
fs.mkdirSync(ext, { recursive: true });
const manifest = {
  manifest_version: 3,
  name: '反重力：Antigravity 中文界面',
  short_name: '反重力中文',
  version,
  version_name: `${appVersion}（词典第 ${dict.revision} 版）`,
  description: '把 Google Antigravity 网页版的界面翻译成中文，对话内容和代码保持原样。非官方，与 Google 无关。',
  icons: { 16: 'icon16.png', 32: 'icon32.png', 48: 'icon48.png', 128: 'icon128.png' },
  action: { default_popup: 'popup.html', default_title: '反重力中文', default_icon: { 16: 'icon16.png', 32: 'icon32.png' } },
  background: { service_worker: 'background.js' },
  content_scripts: [
    { matches, js: ['translator.js', 'dict.js', 'content.js'], run_at: 'document_start', all_frames: true },
  ],
  permissions: ['storage', 'scripting', 'alarms', 'clipboardWrite'],
  host_permissions: matches,
  minimum_chrome_version: '111',
};
fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
fs.writeFileSync(path.join(ext, 'translator.js'), translatorJs);
fs.writeFileSync(path.join(ext, 'dict.js'), `// 由 web/build.mjs 生成：翻译词典第 ${dict.revision} 版\nself.__AG_DICT = ${dictJson};\n`);
for (const f of ['content.js', 'background.js', 'popup.html', 'popup.js']) {
  fs.copyFileSync(path.join(root, 'web/extension', f), path.join(ext, f));
}
for (const size of [16, 32, 48, 128]) {
  fs.copyFileSync(path.join(root, `web/icons/icon${size}.png`), path.join(ext, `icon${size}.png`));
}

const zipPath = path.join(dist, 'antigravity-zh-extension.zip');
fs.rmSync(zipPath, { force: true });
try {
  execFileSync('zip', ['-q', '-r', '-X', zipPath, '.'], { cwd: ext });
} catch (e) {
  console.warn('没有 zip 命令，跳过压缩包（直接用 dist/extension 文件夹即可）');
}

console.log(`版本 ${version}：dist/antigravity-zh.user.js、dist/extension/${fs.existsSync(zipPath) ? '、dist/antigravity-zh-extension.zip' : ''}`);
