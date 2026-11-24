// 反重力浏览器扩展的弹出面板：开关中文、查看词典版本、手动更新词典、复制未翻译的词条。
const $ = (id) => document.getElementById(id);
const bundled = self.__AG_DICT;
const AG_URL = /^https:\/\/(antigravity\.google\.com|antigravity\.static\.usercontent\.goog)\//;

function say(text) {
  $('status').textContent = text;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function showDict() {
  const { dict } = await chrome.storage.local.get('dict');
  const d = dict && dict.revision > bundled.revision ? dict : bundled;
  const count = Object.keys(d.strings).length + (d.patterns ? d.patterns.length : 0);
  $('dict').textContent = `第 ${d.revision} 版 · ${count} 条${d === bundled ? '' : '（已在线更新）'}`;
}

async function init() {
  const manifest = chrome.runtime.getManifest();
  $('version').textContent = `版本 ${manifest.version_name || manifest.version}`;
  const { enabled } = await chrome.storage.local.get('enabled');
  $('enabled').checked = enabled !== false;
  await showDict();
}

$('enabled').addEventListener('change', async (e) => {
  await chrome.storage.local.set({ enabled: e.target.checked });
  const tab = await activeTab();
  if (tab && AG_URL.test(tab.url || '')) {
    chrome.tabs.reload(tab.id);
    say(e.target.checked ? '已开启，页面正在刷新' : '已关闭，页面正在刷新');
  } else {
    say(e.target.checked ? '已开启' : '已关闭');
  }
});

$('check').addEventListener('click', async () => {
  say('正在检查…');
  const result = await chrome.runtime.sendMessage({ type: 'checkDict' });
  say((result && result.message) || '检查失败');
  await showDict();
});

$('missing').addEventListener('click', async () => {
  const tab = await activeTab();
  if (!tab || !AG_URL.test(tab.url || '')) {
    say('请先打开 antigravity.google.com 再点这里');
    return;
  }
  try {
    // 主页面和远程控制界面（iframe）各有一份记录，合在一起
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () => (window.__agI18n ? window.__agI18n.missing() : []),
    });
    const all = [...new Set(results.flatMap((r) => r.result || []))];
    if (!all.length) {
      say('目前没有记录到没翻译的英文');
      return;
    }
    await navigator.clipboard.writeText(JSON.stringify(all, null, 0));
    say(`已复制 ${all.length} 条，发给开发者就能补进词典`);
  } catch (e) {
    say('复制失败：' + e.message);
  }
});

init();
