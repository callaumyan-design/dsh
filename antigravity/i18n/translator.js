// 反重力（安卓壳）的界面翻译：把 Antigravity 网页上的英文界面文字换成中文。
//
// 做法：页面一开始加载就监听整个文档（MutationObserver），每出现一段文字，
// 整段和词典比对，完全对得上才替换；对话内容、代码、编辑器、输入框里的文字一律不碰。
// 词典在 zh-CN.json：strings 是一一对照，patterns 是带数字、时间等变化部分的规则。
//
// 应用会在页面里调用 __agInstallTranslator(window, 配置, 词典)。
// eslint-disable-next-line no-unused-vars
function __agInstallTranslator(win, config, dict) {
  'use strict';
  if (win.__agI18n) {
    win.__agI18n.update(dict);
    return win.__agI18n;
  }
  var doc = win.document;
  var NodeFilterRef = win.NodeFilter;

  var LATIN = /[A-Za-z]/;
  var CJK = /[㐀-鿿豈-﫿]/;
  var MAX_TEXT = 300;

  // 这些地方的文字不翻译：代码、终端、编辑器、渲染后的对话内容、图标字体等
  var SKIP_TAGS = {
    SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, TEXTAREA: 1, INPUT: 1, CODE: 1, PRE: 1,
    KBD: 1, SAMP: 1, VAR: 1, svg: 1, SVG: 1, math: 1, MATH: 1, CANVAS: 1, IFRAME: 1, OBJECT: 1
  };
  var SKIP_SELECTOR = [
    'script', 'style', 'noscript', 'template', 'textarea', 'code', 'pre', 'kbd', 'samp', 'var', 'svg', 'math',
    '[contenteditable]:not([contenteditable="false"])', '[role="textbox"]',
    '[translate="no"]', '.notranslate', '[data-ag-no-translate]',
    'mat-icon', '.material-icons', '.material-icons-outlined', '.material-icons-round',
    '.material-symbols-outlined', '.material-symbols-rounded', '.material-symbols-sharp',
    '.google-symbols', '.google-material-icons', '[class*="material-symbols"]', '[class*="material-icons"]',
    '.monaco-editor', '.cm-editor', '.CodeMirror', '.ProseMirror', '.xterm', '.terminal',
    '[class*="markdown"]', '[class*="Markdown"]', '[class*="prose"]',
    '[class*="code-block"]', '[class*="codeblock"]', '[class*="CodeBlock"]', '[class*="diff-"]'
  ].join(',');
  // 属性只跳过代码区和明确标了不翻译的地方（输入框的占位提示要翻译）
  var ATTR_SKIP_SELECTOR = 'pre,code,[translate="no"],.notranslate,[data-ag-no-translate],.monaco-editor,.cm-editor,.xterm';
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'aria-description', 'aria-placeholder', 'data-placeholder', 'value'];
  var BUTTON_INPUTS = { button: 1, submit: 1, reset: 1 };
  var TAIL_PUNCT = { ':': '：', '.': '。', '...': '…', '?': '？', '!': '！' };

  var strings;
  var lower;
  var patterns;
  var enabled = !config || config.enabled !== false;

  function norm(s) {
    return String(s)
      .replace(/[\s​⁠﻿]+/g, ' ')
      .trim()
      .replace(/[‘’ʼ]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/…/g, '...');
  }

  function compile(d) {
    strings = Object.create(null);
    lower = Object.create(null);
    patterns = [];
    var src = (d && d.strings) || {};
    for (var k in src) {
      if (!Object.prototype.hasOwnProperty.call(src, k) || typeof src[k] !== 'string') continue;
      var key = norm(k);
      strings[key] = src[k];
      var lk = key.toLowerCase();
      if (!(lk in lower)) lower[lk] = src[k];
    }
    var list = (d && d.patterns) || [];
    for (var i = 0; i < list.length; i++) {
      try {
        patterns.push({ re: new RegExp(list[i].re), to: String(list[i].to) });
      } catch (e) {
        // 写错的规则跳过
      }
    }
  }

  // 查一段（已规整的）文字；查不到返回 null
  function lookup(text, depth) {
    if (!text) return null;
    var hit = strings[text];
    if (hit !== undefined) return hit;
    // 大小写不同的写法（New Conversation / New conversation）。只认首字母大写的，
    // 图标字体的名字（settings、arrow_back 这类全小写）不会被当成文字翻译。
    if (/^[A-Z]/.test(text)) {
      hit = lower[text.toLowerCase()];
      if (hit !== undefined) return hit;
    }
    for (var i = 0; i < patterns.length; i++) {
      var m = patterns[i].re.exec(text);
      if (m) return expand(patterns[i].to, m, depth);
    }
    if (depth < 3) {
      var t = /^(.+?)\s*(\.\.\.|[:.?!])$/.exec(text);
      if (t) {
        var base = lookup(t[1], depth + 1);
        if (base != null) return base + TAIL_PUNCT[t[2]];
      }
    }
    return null;
  }

  // 规则里的 {1} 表示“把第 1 组也翻译了”，$1 表示原样放回
  function expand(to, m, depth) {
    return to.replace(/\{(\d)\}|\$(\d)/g, function (all, t, raw) {
      if (raw) return m[+raw] || '';
      var g = m[+t] || '';
      if (depth >= 3) return g;
      var n = norm(g);
      var tr = lookup(n, depth + 1);
      if (tr == null) tr = lower[n.toLowerCase()];
      return tr != null ? tr : g;
    });
  }

  function translateString(s) {
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
    var core = norm(m[2]);
    if (!core || core.length > MAX_TEXT || !LATIN.test(core)) return null;
    var tr = lookup(core, 0);
    return tr == null ? null : { text: m[1] + tr + m[3], core: core };
  }

  function hostElement(node) {
    var p = node.parentNode;
    if (!p) return null;
    if (p.nodeType === 1) return p;
    if (p.nodeType === 11 && p.host) return p.host;
    return null;
  }

  function skipped(el) {
    if (!el || el.nodeType !== 1) return false;
    if (SKIP_TAGS[el.tagName] || el.isContentEditable) return true;
    return !!(el.closest && el.closest(SKIP_SELECTOR));
  }

  // ------------------------------------------------------------ 文字

  var setByUs = new WeakMap();

  function applyText(node, el) {
    var value = node.nodeValue;
    if (!value || value.length > MAX_TEXT * 2 || setByUs.get(node) === value || !LATIN.test(value)) return;
    var r = translateString(value);
    if (r == null) {
      noteMissing(value, el);
      return;
    }
    if (r.text !== value) {
      setByUs.set(node, r.text);
      node.nodeValue = r.text;
    }
  }

  function translateTextChecked(node) {
    var el = hostElement(node);
    if (!el || skipped(el)) return;
    applyText(node, el);
  }

  // ------------------------------------------------------------ 属性

  var attrsByUs = new WeakMap();

  function translateAttr(el, name) {
    if (name === 'value' && !(el.tagName === 'INPUT' && BUTTON_INPUTS[(el.getAttribute('type') || '').toLowerCase()])) return;
    var v = el.getAttribute(name);
    if (!v || v.length > MAX_TEXT || !LATIN.test(v)) return;
    var rec = attrsByUs.get(el);
    if (rec && rec[name] === v) return;
    var r = translateString(v);
    if (r == null) {
      if (name !== 'alt') noteMissing(v, el);
      return;
    }
    if (!rec) {
      rec = {};
      attrsByUs.set(el, rec);
    }
    rec[name] = r.text;
    el.setAttribute(name, r.text);
  }

  function translateAttrs(el) {
    if (!el.hasAttributes || !el.hasAttributes()) return;
    if (el.closest && el.closest(ATTR_SKIP_SELECTOR)) return;
    for (var i = 0; i < ATTRS.length; i++) {
      if (el.hasAttribute(ATTRS[i])) translateAttr(el, ATTRS[i]);
    }
  }

  // ------------------------------------------------------------ 遍历与监听

  var filter = {
    acceptNode: function (n) {
      if (n.nodeType === 3) return NodeFilterRef.FILTER_ACCEPT;
      if (SKIP_TAGS[n.tagName] || n.isContentEditable || (n.matches && n.matches(SKIP_SELECTOR))) {
        translateAttrs(n);
        return NodeFilterRef.FILTER_REJECT;
      }
      return NodeFilterRef.FILTER_ACCEPT;
    }
  };

  function translateTree(root) {
    if (!enabled || !root) return;
    if (root.nodeType === 3) {
      translateTextChecked(root);
      return;
    }
    if (root.nodeType === 1) {
      if (skipped(root)) {
        translateAttrs(root);
        return;
      }
      translateAttrs(root);
      if (root.shadowRoot) watch(root.shadowRoot);
    } else if (root.nodeType !== 9 && root.nodeType !== 11) {
      return;
    }
    var walker = doc.createTreeWalker(root, NodeFilterRef.SHOW_ELEMENT | NodeFilterRef.SHOW_TEXT, filter);
    var n;
    while ((n = walker.nextNode())) {
      if (n.nodeType === 3) {
        var el = hostElement(n);
        if (el) applyText(n, el);
      } else {
        translateAttrs(n);
        if (n.shadowRoot) watch(n.shadowRoot);
      }
    }
  }

  var OPTIONS = { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS };
  var watched = new WeakSet();
  var observer = new win.MutationObserver(function (records) {
    if (!enabled) return;
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.type === 'childList') {
        for (var j = 0; j < r.addedNodes.length; j++) {
          var n = r.addedNodes[j];
          if (n.nodeType === 3) translateTextChecked(n);
          else if (n.nodeType === 1) {
            var parent = hostElement(n);
            if (parent && skipped(parent)) translateAttrs(n);
            else translateTree(n);
          }
        }
      } else if (r.type === 'characterData') {
        translateTextChecked(r.target);
      } else if (r.type === 'attributes' && r.target.nodeType === 1) {
        if (!(r.target.closest && r.target.closest(ATTR_SKIP_SELECTOR))) translateAttr(r.target, r.attributeName);
      }
    }
  });

  function watch(root) {
    if (watched.has(root)) return;
    watched.add(root);
    observer.observe(root, OPTIONS);
    if (root !== doc) translateTree(root);
  }

  // ------------------------------------------------------------ 没翻译的文字：记下来交给应用

  var missingSeen = Object.create(null);
  var missingCount = 0;
  var missingQueue = [];
  var flushTimer = 0;

  function noteMissing(raw, el) {
    var s = norm(raw);
    if (s.length < 2 || s.length > 120 || missingSeen[s] || missingCount >= 2000) return;
    if (CJK.test(s) || !/[a-z]/i.test(s)) return;
    if (/^https?:\/\//i.test(s)) return;
    // 路径、文件名、版本号、标识符、邮箱这类不是界面文字
    if (!/\s/.test(s) && (/[\/\\._:@#~=]/.test(s) || /[a-z][A-Z]/.test(s) || /_/.test(s))) return;
    if (/^[\d\s.,:%+\-x×/()]+[A-Za-z]{0,3}$/.test(s)) return;
    if (el && el.closest && el.closest('a[href^="http"]') && !/\s/.test(s)) return;
    missingSeen[s] = 1;
    missingCount++;
    missingQueue.push(s);
    if (!flushTimer) flushTimer = win.setTimeout(flushMissing, 2000);
  }

  function flushMissing() {
    flushTimer = 0;
    if (!missingQueue.length) return;
    var items = missingQueue.splice(0, 200);
    try {
      if (win.AgBridge && typeof win.AgBridge.postMessage === 'function') {
        win.AgBridge.postMessage(JSON.stringify({ t: 'missing', items: items }));
      }
    } catch (e) {
      // 应用不在时忽略
    }
    if (missingQueue.length) flushTimer = win.setTimeout(flushMissing, 2000);
  }

  // ------------------------------------------------------------ 启动

  compile(dict);
  var api = {
    update: function (d) {
      compile(d);
      translateTree(doc.documentElement);
    },
    translate: function (s) {
      var r = translateString(String(s));
      return r ? r.text : null;
    },
    missing: function () {
      return Object.keys(missingSeen);
    },
    revision: config && config.revision
  };
  win.__agI18n = api;
  watch(doc);
  if (doc.documentElement) translateTree(doc.documentElement);
  return api;
}
