// Markdown 渲染器的检查：功能正确 + 不会被恶意内容利用
// 运行方法：在仓库根目录执行  node --test
import test from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "../assets/js/ai/markdown.js";

test("基本排版", () => {
  assert.equal(renderMarkdown("# 标题"), "<h1>标题</h1>");
  assert.equal(renderMarkdown("**粗** *斜* ~~删~~ `码`"), "<p><strong>粗</strong> <em>斜</em> <del>删</del> <code>码</code></p>");
  assert.equal(renderMarkdown("第一行\n第二行\n\n第二段"), "<p>第一行<br>第二行</p><p>第二段</p>");
  assert.equal(renderMarkdown("---"), "<hr>");
  assert.equal(renderMarkdown("> 引用"), "<blockquote><p>引用</p></blockquote>");
});

test("列表：有序、无序、嵌套、任务", () => {
  assert.equal(renderMarkdown("- a\n- b"), "<ul><li>a</li><li>b</li></ul>");
  assert.equal(renderMarkdown("3. a\n4. b"), '<ol start="3"><li>a</li><li>b</li></ol>');
  assert.equal(renderMarkdown("1. a\n   - b\n   - c\n2. d"), "<ol><li>a<ul><li>b</li><li>c</li></ul></li><li>d</li></ol>");
  assert.equal(renderMarkdown("- [x] 做完\n- [ ] 没做"), "<ul><li>☑ 做完</li><li>☐ 没做</li></ul>");
  // 段落后面紧跟列表（AI 的回答里很常见）
  assert.equal(renderMarkdown("步骤如下：\n1. 一\n2. 二"), "<p>步骤如下：</p><ol><li>一</li><li>二</li></ol>");
  // 列表项里的代码块
  assert.equal(renderMarkdown("1. 运行：\n   ```sh\n   ls -la\n   ```\n2. 完成"), '<ol><li>运行：<pre><code class="language-sh">ls -la</code></pre></li><li>完成</li></ol>');
});

test("代码块原样显示，没写完的代码块（流式输出中）也能显示", () => {
  assert.equal(renderMarkdown("```js\nlet a = '<b>';\n```"), '<pre><code class="language-js">let a = &#39;&lt;b&gt;&#39;;</code></pre>');
  assert.equal(renderMarkdown("```\n**不加粗**"), "<pre><code>**不加粗**</code></pre>");
  assert.equal(renderMarkdown("`a*b*c` 和 snake_case_name"), "<p><code>a*b*c</code> 和 snake_case_name</p>");
});

test("表格", () => {
  const html = renderMarkdown("| 名 | 值 |\n| :-: | --: |\n| a | 1 |\n| b \\| c | 2 |");
  assert.equal(
    html,
    '<div class="table-wrap"><table><thead><tr><th class="al-c">名</th><th class="al-r">值</th></tr></thead>' +
      '<tbody><tr><td class="al-c">a</td><td class="al-r">1</td></tr><tr><td class="al-c">b | c</td><td class="al-r">2</td></tr></tbody></table></div>'
  );
});

test("链接：只允许 http / https / mailto，并且在新标签页安全打开", () => {
  const attrs = 'target="_blank" rel="noopener noreferrer"';
  assert.equal(renderMarkdown("[站点](https://example.com/a?b=1&c=2)"), `<p><a href="https://example.com/a?b=1&amp;c=2" ${attrs}>站点</a></p>`);
  assert.equal(renderMarkdown("见 https://example.com/x_y_z。"), `<p>见 <a href="https://example.com/x_y_z" ${attrs}>https://example.com/x_y_z</a>。</p>`);
  assert.equal(renderMarkdown("(https://example.com/a)"), `<p>(<a href="https://example.com/a" ${attrs}>https://example.com/a</a>)</p>`);
  // 图片语法不加载外部图片，只显示成链接
  assert.equal(renderMarkdown("![猫](https://example.com/cat.png)"), `<p><a href="https://example.com/cat.png" ${attrs}>猫</a></p>`);
});

test("安全：恶意内容一律当成普通文字", () => {
  const cases = [
    "<script>alert(1)</script>",
    '<img src=x onerror="alert(1)">',
    "[点我](javascript:alert(1))",
    "[点我](JaVaScRiPt:alert(1))",
    "[点我](data:text/html,<script>alert(1)</script>)",
    "[点我](vbscript:msgbox(1))",
    '[a](https://x.com/"onmouseover="alert(1))',
    '[a](https://x.com "t\\" onmouseover=\\"alert(1)")',
    "![x](javascript:alert(1))",
    '<a href="javascript:alert(1)">x</a>',
    "```<img src=x onerror=alert(1)>\ncode\n```",
    '```js" onmouseover="alert(1)\ncode\n```',
    "| <script>x</script> | b |\n| --- | --- |\n| <b>1</b> | 2 |",
    '<svg onload="alert(1)">',
    "&lt;script&gt;",
    "\u0000<script>\u00001\u0000",
    "\u00000\u0000 [a](https://ok.example/)",
  ];
  for (const src of cases) {
    const html = renderMarkdown(src);
    // 输出里只允许出现白名单标签
    const tags = [...html.matchAll(/<\/?([a-zA-Z0-9]+)/g)].map((m) => m[1].toLowerCase());
    const allowed = new Set(["p", "br", "strong", "em", "del", "code", "pre", "a", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "hr", "table", "thead", "tbody", "tr", "th", "td", "div"]);
    for (const tag of tags) assert.ok(allowed.has(tag), `出现了不允许的标签 <${tag}>：${src} → ${html}`);
    // 标签里不允许出现事件属性；链接只能是安全协议
    for (const m of html.matchAll(/<[a-zA-Z][^>]*>/g)) {
      assert.ok(!/\son\w+\s*=/i.test(m[0]), `标签里出现了事件属性：${src} → ${m[0]}`);
      assert.ok(!/style\s*=/i.test(m[0]), `标签里出现了 style：${src} → ${m[0]}`);
    }
    for (const m of html.matchAll(/href="([^"]*)"/g)) assert.match(m[1], /^(https?:\/\/|mailto:)/i, `不安全的链接：${src} → ${m[1]}`);
    assert.ok(!html.includes("\u0000"), "输出里不应有占位符残留");
  }
});

test("很长的内容不会卡死", () => {
  const big = ("这是一段比较长的文字，带 **粗体** 和 `代码`，还有 [链接](https://example.com)。\n\n- 列表\n- 列表\n\n").repeat(400);
  const start = Date.now();
  renderMarkdown(big);
  assert.ok(Date.now() - start < 1500);
  // 大量没闭合的反引号也不能拖慢
  const start2 = Date.now();
  renderMarkdown("`a ".repeat(4000));
  assert.ok(Date.now() - start2 < 1500, `耗时 ${Date.now() - start2}ms`);
});
