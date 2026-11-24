// 反重力浏览器扩展：在 Antigravity 页面（以及远程控制界面的 iframe）里启动翻译。
// translator.js 和 dict.js 先加载，这里只负责读设置、选词典。
(function () {
  'use strict';
  if (window.__agExtStarted) return;
  window.__agExtStarted = true;

  var bundled = self.__AG_DICT;

  function newer(stored) {
    return stored && typeof stored.revision === 'number' && stored.revision > bundled.revision ? stored : bundled;
  }

  function start(dict) {
    __agInstallTranslator(window, { revision: dict.revision }, dict);
  }

  try {
    chrome.storage.local.get(['enabled', 'dict'], function (v) {
      if (chrome.runtime.lastError || !v) v = {};
      if (v.enabled === false) return;
      start(newer(v.dict));
    });
    // 后台下载到新词典后，已经打开的页面立即换上
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local' || !changes.dict || !window.__agI18n) return;
      var d = changes.dict.newValue;
      if (d && d.revision > bundled.revision) window.__agI18n.update(d);
    });
  } catch (e) {
    start(bundled);
  }
})();
