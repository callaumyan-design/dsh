// 反重力（安卓壳）注入 Antigravity 页面的辅助脚本：
//  - 把页面顶部、底部的颜色告诉应用，用来给状态栏和导航栏上色；
//  - 记住用户点的下载链接的文件名，帮应用保存网页生成的文件（blob:）。
// 只在 antigravity.google.com 上运行。应用通过 AgBridge 收消息；没有 AgBridge 时什么也不发。
(function () {
  'use strict';
  if (window.__agShell) return;
  window.__agShell = true;

  function post(message) {
    try {
      if (window.AgBridge && typeof window.AgBridge.postMessage === 'function') {
        window.AgBridge.postMessage(JSON.stringify(message));
      }
    } catch (e) {
      // 应用不在时忽略
    }
  }

  function isTransparent(c) {
    if (!c || c === 'transparent') return true;
    var m = /rgba?\(([^)]+)\)/.exec(c);
    if (!m) return false;
    var parts = m[1].split(/[,\s/]+/).filter(Boolean);
    return parts.length === 4 && parseFloat(parts[3]) < 0.5;
  }

  // 从某个点往上找第一个有底色的元素
  function colorAt(x, y) {
    var el = document.elementFromPoint(x, y);
    while (el && el.nodeType === 1) {
      var c = getComputedStyle(el).backgroundColor;
      if (!isTransparent(c)) return c;
      el = el.parentElement;
    }
    var body = document.body && getComputedStyle(document.body).backgroundColor;
    if (!isTransparent(body)) return body;
    var html = document.documentElement && getComputedStyle(document.documentElement).backgroundColor;
    if (!isTransparent(html)) return html;
    var meta = document.querySelector('meta[name="theme-color"]');
    return meta ? meta.getAttribute('content') : '';
  }

  var lastTop = '';
  var lastBottom = '';
  function reportTheme() {
    if (window.top !== window || !document.documentElement) return;
    var w = window.innerWidth || 1;
    var h = window.innerHeight || 1;
    var top = colorAt(w / 2, 1);
    var bottom = colorAt(w / 2, h - 2);
    if (top && (top !== lastTop || bottom !== lastBottom)) {
      lastTop = top;
      lastBottom = bottom;
      post({ t: 'theme', top: top, bottom: bottom || top });
    }
  }
  document.addEventListener('DOMContentLoaded', reportTheme);
  window.addEventListener('load', reportTheme);
  setInterval(reportTheme, 1500);

  // 网页生成的下载（<a download href="blob:...">）：记下文件名
  var lastDownload = null;
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[download]') : null;
    if (a) lastDownload = { href: a.href, name: a.getAttribute('download') || '' };
  }, true);

  // 应用收到 blob: 下载时调用：读出文件内容，转成 data: 网址交给应用保存
  window.__agFetchBlob = function (url, mime, token) {
    var name = lastDownload && lastDownload.href === url ? lastDownload.name : '';
    fetch(url).then(function (r) { return r.blob(); }).then(function (blob) {
      var reader = new FileReader();
      reader.onload = function () {
        post({ t: 'blob', token: token, name: name, mime: blob.type || mime || '', data: String(reader.result) });
      };
      reader.onerror = function () { post({ t: 'blobError', token: token }); };
      reader.readAsDataURL(blob);
    }).catch(function () {
      post({ t: 'blobError', token: token });
    });
  };
})();
