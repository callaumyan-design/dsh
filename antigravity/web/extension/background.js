// 反重力浏览器扩展的后台：每 12 小时从 GitHub 取一次最新词典（只是文字对照表，不含代码）。
// 手动加载的扩展不会自动更新，这样补充的翻译也能用上。
/* global importScripts */
importScripts('dict.js');

const REMOTE_URLS = [
  'https://raw.githubusercontent.com/callaumyan-design/dsh/main/antigravity/i18n/zh-CN.json',
  'https://cdn.jsdelivr.net/gh/callaumyan-design/dsh@main/antigravity/i18n/zh-CN.json',
];
const CHECK_MINUTES = 12 * 60;

function valid(d) {
  if (!d || d.schema !== 1 || !Number.isInteger(d.revision) || d.revision <= 0) return false;
  if (!d.strings || typeof d.strings !== 'object' || Array.isArray(d.strings)) return false;
  if (!Object.values(d.strings).every((v) => typeof v === 'string')) return false;
  if (d.patterns != null) {
    if (!Array.isArray(d.patterns)) return false;
    if (!d.patterns.every((p) => p && typeof p.re === 'string' && typeof p.to === 'string')) return false;
  }
  return true;
}

async function checkForUpdate() {
  const { dict: stored } = await chrome.storage.local.get('dict');
  const have = Math.max(self.__AG_DICT.revision, (stored && stored.revision) || 0);
  for (const url of REMOTE_URLS) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;
      const d = await res.json();
      if (!valid(d)) return { ok: false, message: '网上的词典格式不对，先用现有的' };
      await chrome.storage.local.set({ checkedAt: Date.now() });
      if (d.revision > have) {
        await chrome.storage.local.set({ dict: d });
        return { ok: true, updated: true, revision: d.revision, message: `翻译词典已更新到第 ${d.revision} 版` };
      }
      return { ok: true, updated: false, revision: have, message: `翻译词典已是最新（第 ${have} 版）` };
    } catch (e) {
      // 换下一个地址
    }
  }
  return { ok: false, message: '没能连上 GitHub，稍后再试' };
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('dict', { periodInMinutes: CHECK_MINUTES });
  checkForUpdate();
});
chrome.runtime.onStartup.addListener(() => {
  checkForUpdate();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'dict') checkForUpdate();
});
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'checkDict') {
    checkForUpdate().then(sendResponse);
    return true;
  }
  return false;
});
