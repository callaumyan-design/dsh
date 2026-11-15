// 轻量 Markdown 渲染器（不引入第三方库）。
// 安全做法：所有文字先做 HTML 转义，只输出这里写死的几种标签；链接只允许 http / https / mailto。
// 支持：标题、粗体、斜体、删除线、行内代码、代码块、链接、列表（可嵌套）、引用、表格、分隔线。

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const UNESCAPES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" };

export const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);
const unescapeHtml = (s) => s.replace(/&(amp|lt|gt|quot|#39);/g, (m, name) => UNESCAPES[name]);

function safeHref(url) {
  const compact = url.replace(/[\u0000- ]+/g, "");
  return /^(https?:\/\/|mailto:)/i.test(compact) ? url.trim() : "";
}

const LINK_ATTRS = 'target="_blank" rel="noopener noreferrer"';

// ---------- 行内语法 ----------
function inline(src) {
  // 已经生成好的 HTML 片段先"寄存"起来，换成占位符，避免被后面的规则再次处理
  const stash = [];
  const keep = (html) => `\u0000${stash.push(html) - 1}\u0000`;
  const link = (url, label) => {
    const href = safeHref(unescapeHtml(url));
    return href ? keep(`<a href="${escapeHtml(href)}" ${LINK_ATTRS}>`) + label + keep("</a>") : label;
  };

  let text = src
    // 行内代码
    .replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (m, ticks, code) => keep(`<code>${escapeHtml(code.trim())}</code>`))
    // 反斜杠转义，例如 \* 就是一个普通的星号
    .replace(/\\([\\`*_{}[\]()#+\-.!~|<>])/g, (m, ch) => keep(escapeHtml(ch)));

  text = escapeHtml(text)
    // 图片语法不加载外部图片（保护隐私），只显示成一个链接
    .replace(/!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+&quot;[^\n]*?&quot;)?\)/g, (m, alt, url) => link(url, alt || "图片"))
    // [文字](网址)
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)(?:\s+&quot;[^\n]*?&quot;)?\)/g, (m, label, url) => link(url, label))
    // 直接写出来的网址
    .replace(/(^|[^\w\u0000/"=])(https?:\/\/[^\s<\u0000]+)/g, (m, pre, url) => {
      // 网址末尾的标点通常不属于网址
      const trail = /(?:[.,;:!?。，；：！？”’】\]]|&quot;|&#39;|&gt;)+$/.exec(url);
      let tail = "";
      if (trail) {
        tail = trail[0];
        url = url.slice(0, -tail.length);
      }
      if (/[)）]$/.test(url) && !url.includes("(")) {
        tail = url.slice(-1) + tail;
        url = url.slice(0, -1);
      }
      return pre + keep(`<a href="${url}" ${LINK_ATTRS}>`) + url + keep("</a>") + tail;
    })
    // 粗体、斜体、删除线
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, "$1<strong>$2</strong>")
    .replace(/\*(?=[^\s*])([^*\n]*?[^\s*])\*/g, "<em>$1</em>")
    .replace(/(^|[^\w])_(?=[^\s_])([^_\n]*?[^\s_])_(?!\w)/g, "$1<em>$2</em>")
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "<del>$1</del>")
    // 段落里的换行保留成换行
    .replace(/\n/g, "<br>");

  return text.replace(/\u0000(\d+)\u0000/g, (m, i) => stash[Number(i)]);
}

// ---------- 块级语法 ----------
const RE = {
  fence: /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/,
  heading: /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/,
  hr: /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/,
  quote: /^ {0,3}>\s?(.*)$/,
  item: /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/,
  tableSep: /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/,
};

const indentOf = (line) => line.length - line.trimStart().length;
const isOrdered = (marker) => /\d/.test(marker);

function isTableStart(lines, i) {
  return lines[i].includes("|") && i + 1 < lines.length && lines[i + 1].includes("|") && RE.tableSep.test(lines[i + 1]);
}

/** 这一行是不是另一种块的开头（用来判断段落、列表在哪里结束） */
function startsBlock(lines, i) {
  const line = lines[i];
  return RE.fence.test(line) || RE.heading.test(line) || RE.hr.test(line) || RE.quote.test(line) || RE.item.test(line) || isTableStart(lines, i);
}

/** 把表格的一行拆成单元格（\| 表示单元格里的竖线） */
function splitRow(line) {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  const cells = [];
  let cell = "";
  for (let i = 0; i < row.length; i++) {
    if (row[i] === "\\" && row[i + 1] === "|") {
      cell += "|";
      i++;
    } else if (row[i] === "|") {
      cells.push(cell.trim());
      cell = "";
    } else cell += row[i];
  }
  cells.push(cell.trim());
  return cells;
}

function parseTable(lines, start) {
  const head = splitRow(lines[start]);
  const aligns = splitRow(lines[start + 1]).map((c) => (/^:-+:$/.test(c) ? " class=\"al-c\"" : /-+:$/.test(c) ? " class=\"al-r\"" : ""));
  let i = start + 2;
  const rows = [];
  while (i < lines.length && lines[i].trim() && lines[i].includes("|")) rows.push(splitRow(lines[i++]));
  const cellsHtml = (cells, tag) => head.map((_, c) => `<${tag}${aligns[c] || ""}>${inline(cells[c] || "")}</${tag}>`).join("");
  const html =
    `<div class="table-wrap"><table><thead><tr>${cellsHtml(head, "th")}</tr></thead>` +
    `<tbody>${rows.map((r) => `<tr>${cellsHtml(r, "td")}</tr>`).join("")}</tbody></table></div>`;
  return { html, next: i };
}

function parseList(lines, start) {
  const first = RE.item.exec(lines[start]);
  const baseIndent = first[1].length;
  const ordered = isOrdered(first[2]);
  const isSibling = (m) => m && m[1].length <= baseIndent + 1 && isOrdered(m[2]) === ordered;
  const items = [];
  let i = start;

  while (i < lines.length) {
    const m = RE.item.exec(lines[i]);
    if (!isSibling(m)) break;
    const contentIndent = m[1].length + m[2].length + 1;
    // 任务列表的方框
    const body = [m[3].replace(/^\[( |x|X)\]\s+/, (t, c) => (c === " " ? "☐ " : "☑ "))];
    i++;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        // 空行之后：还有缩进内容就仍属于这一条；是同级条目就继续列表；否则列表结束
        let j = i + 1;
        while (j < lines.length && !lines[j].trim()) j++;
        if (j >= lines.length) {
          i = j;
          break;
        }
        if (indentOf(lines[j]) >= baseIndent + 2) {
          body.push("");
          i = j;
          continue;
        }
        if (isSibling(RE.item.exec(lines[j]))) i = j;
        break;
      }
      const indent = indentOf(line);
      if (indent >= baseIndent + 2) {
        body.push(line.slice(Math.min(indent, contentIndent))); // 去掉缩进后交给下一层解析（嵌套列表、代码块等）
        i++;
      } else if (startsBlock(lines, i)) {
        break;
      } else {
        body.push(line.trim()); // 没缩进的普通文字，接在这一条后面
        i++;
      }
    }
    items.push(body);
  }

  const tag = ordered ? "ol" : "ul";
  const startNum = ordered ? parseInt(first[2], 10) : 1;
  const attr = ordered && startNum !== 1 ? ` start="${startNum}"` : "";
  // 每一条的第一段文字不套 <p>，排版更紧凑
  const html = items.map((body) => `<li>${blocks(body).replace(/^<p>([\s\S]*?)<\/p>/, "$1")}</li>`).join("");
  return { html: `<${tag}${attr}>${html}</${tag}>`, next: i };
}

function blocks(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    let m = RE.fence.exec(line);
    if (m) {
      // 代码块：一直到同样的围栏结束；流式输出时还没等到结尾也照样显示
      const closing = new RegExp(`^ {0,3}${m[1][0]}{${m[1].length},}\\s*$`);
      const lang = /^[\w+#.-]{1,30}$/.test(m[2]) ? ` class="language-${m[2]}"` : "";
      const code = [];
      i++;
      while (i < lines.length && !closing.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(`<pre><code${lang}>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    m = RE.heading.exec(line);
    if (m) {
      out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
      i++;
      continue;
    }

    if (RE.hr.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }

    if (RE.quote.test(line)) {
      const inner = [];
      while (i < lines.length && RE.quote.test(lines[i])) inner.push(RE.quote.exec(lines[i++])[1]);
      out.push(`<blockquote>${blocks(inner)}</blockquote>`);
      continue;
    }

    if (RE.item.test(line)) {
      const list = parseList(lines, i);
      out.push(list.html);
      i = list.next;
      continue;
    }

    if (isTableStart(lines, i)) {
      const table = parseTable(lines, i);
      out.push(table.html);
      i = table.next;
      continue;
    }

    // 普通段落：一直到空行或别的块开始
    const para = [line.trim()];
    i++;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines, i)) para.push(lines[i++].trim());
    out.push(`<p>${inline(para.join("\n"))}</p>`);
  }
  return out.join("");
}

/** Markdown 文本 → 安全的 HTML 字符串 */
export function renderMarkdown(source) {
  const lines = String(source ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "    ")
    .split("\n");
  return blocks(lines);
}
