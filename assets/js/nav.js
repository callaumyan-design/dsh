// 功能导航：页面下方的一排"小应用图标"。
// 进入编辑模式后展开成带描述的列表，方便拖动排序、隐藏和修改。
// 默认入口来自 config/nav.js；用户在编辑模式里的改动存在浏览器本地，两者合并显示。
import { store, readJSON, writeJSON, removeKey, safeUrl } from "./store.js";
import { buildGroups, normalizeNavState } from "./nav-model.js";
import { $, h, icon, hasIcon, isFramed, BUILD } from "./ui.js";

const NAV_KEY = "sp:nav";

let defaults = [];
let state = normalizeNavState(readJSON(NAV_KEY));
let editor = null; // 编辑模式下由 nav-edit.js 提供

// ---------- 本地改动的读写 ----------
export const navState = {
  get: () => state,
  /** rerender 为 false 时只保存、不重画（拖动排序时页面上已经是新顺序了） */
  set(next, { rerender = true } = {}) {
    state = normalizeNavState(next);
    writeJSON(NAV_KEY, state);
    if (rerender) render();
  },
  reset() {
    state = normalizeNavState(null);
    removeKey(NAV_KEY);
    render();
  },
};

/** 现有的全部分组名（添加入口时用来做下拉提示） */
export function groupNames() {
  return buildGroups(defaults, state, { includeHidden: true }).map((g) => g.name);
}

// ---------- 图标 ----------
/** 入口图标：本地图标库的名字 / 图片地址 / 一个表情或一两个字 / 都没有就用名称首字 */
/**
 * 本站自己的图片（相对路径）在地址后面带上版本号：图标换了新的，手机就不会再用缓存里的旧图。
 * 站外的图片、本机预览（没有版本号）时原样返回。
 */
function withBuild(src) {
  if (!src || !BUILD || /^[a-z][a-z0-9+.-]*:|^\/\//i.test(src)) return src;
  return src + (src.includes("?") ? "&" : "?") + "v=" + BUILD;
}

export function entryIcon(entry, cls = "card-icon") {
  const box = h("span", { class: cls, "aria-hidden": "true" });
  // 指定了底色的入口：底色用它，图标用白色
  if (entry.color) {
    box.style.background = entry.color;
    box.style.color = "#fff";
  }
  const value = entry.icon;
  const firstChar = Array.from(entry.name)[0].toUpperCase();
  if (hasIcon(value)) {
    box.append(icon(value));
  } else if (/[/.]|^data:image\//.test(value)) {
    const src = /^data:image\/(png|jpeg|webp|gif);base64,/.test(value) ? value : withBuild(safeUrl(value, { allowRelative: true }));
    if (src) {
      const img = h("img", { src, alt: "", loading: "lazy", decoding: "async" });
      img.addEventListener("error", () => {
        box.classList.remove("is-img");
        box.replaceChildren(firstChar); // 图片坏了就退回首字
      });
      box.classList.add("is-img");
      box.append(img);
    } else box.append(firstChar);
  } else {
    box.append(value ? Array.from(value).slice(0, 2).join("") : firstChar);
  }
  return box;
}

// ---------- 渲染 ----------
function shouldOpenInNewTab(entry) {
  // 被嵌在别的页面里时，站外入口一律开新标签页（很多网站不允许被嵌入显示）
  if (isFramed() && !isSameOrigin(entry.url)) return true;
  const mode = store.get().linkTarget;
  return mode === "new" ? true : mode === "same" ? false : entry.newTab;
}

function isSameOrigin(url) {
  try {
    return new URL(url, location.href).origin === location.origin;
  } catch {
    return false;
  }
}

/** 平时的样子：一个小应用图标 + 下面的名字 */
function renderApp(entry) {
  const link = h("a", { class: "app", href: entry.url, title: entry.desc ? `${entry.name}：${entry.desc}` : entry.name }, entryIcon(entry, "app-icon"), h("span", { class: "app-name" }, entry.name));
  if (shouldOpenInNewTab(entry)) {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
  return h("li", { class: "card-wrap", dataset: { id: entry.id } }, link);
}

/** 编辑模式的样子：带描述的一行，旁边有拖动把手和操作按钮 */
function renderCard(entry) {
  const link = h(
    "a",
    { class: "card glass", href: entry.url },
    entryIcon(entry),
    h("span", { class: "card-text" }, h("span", { class: "card-name" }, entry.name), entry.desc && h("span", { class: "card-desc" }, entry.desc))
  );
  if (entry.desc) link.title = entry.desc;
  if (shouldOpenInNewTab(entry)) {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
  const li = h("li", { class: `card-wrap${entry.custom ? " is-custom" : ""}${entry.hidden ? " is-hidden" : ""}`, dataset: { id: entry.id } }, link);
  editor.decorate(li, link, entry);
  return li;
}

export function render() {
  const root = $("#nav");
  const groups = buildGroups(defaults, state, { includeHidden: !!editor });
  // 只有一个分组时不显示分组名，保持简洁
  const showTitles = !!editor || groups.length > 1;
  const sections = groups.map((group) =>
    h(
      "section",
      { class: "nav-group", "aria-label": group.name },
      showTitles && h("h2", { class: editor ? "group-title glass" : "group-title" }, group.name),
      editor
        ? h("ul", { class: "nav-grid", dataset: { group: group.name } }, group.items.map(renderCard))
        : h("ul", { class: "app-grid", dataset: { group: group.name } }, group.items.map(renderApp))
    )
  );
  // 平时图标直接摆在背景上、排成一行；编辑模式是普通的列表
  root.replaceChildren(...(editor ? [editor.bar, ...sections] : sections.length ? [h("div", { class: "dock" }, sections)] : []));
  fitRows();
  // 一个入口都没有时，导航区（和"跳到功能导航"的快捷链接）整个不显示，页面保持干净
  const empty = !editor && !sections.length;
  root.hidden = empty;
  const skip = $(".skip-link");
  if (skip) skip.hidden = empty;
  document.body.classList.toggle("editing", !!editor);
}

/**
 * 应用栏每行放几个：一行最多 7 个，再多就平均分成几行（电脑上 13 个排成 7 + 6）；
 * 屏幕窄、一行放不下 7 个时按放得下的个数平均分（手机上 13 个排成 5 + 5 + 3，8 个排成 4 + 4 而不是 5 + 3）。
 * 每个格子至少 62 像素宽（图标 46 + 两边留白），格子之间 2 像素。
 */
const CELL = 62;
const GAP = 2;
const MAX_PER_ROW = 7;
function fitRows() {
  const width = $("#nav")?.clientWidth || 0;
  if (!width) return;
  const fit = Math.min(MAX_PER_ROW, Math.max(1, Math.floor((width + GAP) / (CELL + GAP))));
  for (const grid of document.querySelectorAll("#nav .app-grid")) {
    const n = grid.children.length;
    const rows = Math.ceil(n / fit);
    grid.style.setProperty("--per-row", String(Math.max(1, Math.ceil(n / rows))));
  }
  // 名字放不下（比如手机上的"飞汇地区比价"）：字缩小一点，尽量完整显示，不出省略号
  for (const name of document.querySelectorAll("#nav .app-name")) {
    name.classList.remove("is-tight");
    if (name.scrollWidth > name.clientWidth + 1) name.classList.add("is-tight");
  }
}

// ---------- 启动 ----------
export function initNav(defaultEntries) {
  // 窗口宽度变了（转屏、折叠屏展开）：重新算每行放几个
  if (typeof ResizeObserver === "function") new ResizeObserver(() => fitRows()).observe($("#nav"));
  else window.addEventListener("resize", fitRows);
  defaults = defaultEntries;
  render();

  // "链接打开方式"变了要重画
  let lastTarget = store.get().linkTarget;
  store.subscribe((settings) => {
    if (settings.linkTarget !== lastTarget) {
      lastTarget = settings.linkTarget;
      render();
    }
  });

  // 别的标签页里改了导航，这边同步
  window.addEventListener("storage", (e) => {
    if (e.key === NAV_KEY) {
      state = normalizeNavState(readJSON(NAV_KEY));
      render();
    }
  });

  // 编辑模式（代码用到时才加载）
  const editBtn = $("#btn-edit");
  editBtn.addEventListener("click", async () => {
    if (editor) return exitEdit();
    const { createEditor } = await import("./nav-edit.js");
    editor = createEditor({ exit: exitEdit });
    editBtn.setAttribute("aria-pressed", "true");
    editBtn.setAttribute("aria-label", "完成编辑");
    editBtn.title = "完成编辑";
    render();
    $("#nav").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  function exitEdit() {
    editor = null;
    editBtn.setAttribute("aria-pressed", "false");
    editBtn.setAttribute("aria-label", "编辑导航");
    editBtn.title = "编辑导航";
    render();
  }
}
