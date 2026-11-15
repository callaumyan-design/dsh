// 搜索框：引擎切换、快捷键、"!前缀"直达、本地搜索历史
import { store, readJSON, writeJSON, removeKey } from "./store.js";
import { listEngines, buildSearchUrl, parseBang } from "./engines.js";
import { $, h, icon, iconButton, announce, isModalOpen, isFramed } from "./ui.js";

const HISTORY_KEY = "sp:history";
const HISTORY_MAX = 50; // 最多保存多少条
const HISTORY_SHOW = 8; // 下拉里最多显示多少条

// ---------- 本地搜索历史（只存在这台设备的浏览器里） ----------
export const searchHistory = {
  list() {
    const data = readJSON(HISTORY_KEY, []);
    return Array.isArray(data) ? data.filter((x) => typeof x === "string") : [];
  },
  add(query) {
    const next = [query, ...this.list().filter((x) => x !== query)].slice(0, HISTORY_MAX);
    writeJSON(HISTORY_KEY, next);
  },
  remove(query) {
    writeJSON(HISTORY_KEY, this.list().filter((x) => x !== query));
  },
  clear() {
    removeKey(HISTORY_KEY);
  },
};

/** 打开一个网址：新标签页或当前页 */
export function openUrl(url, newTab) {
  // 被嵌在别的页面里时一律开新标签页：搜索引擎不允许自己被嵌在别的页面里显示
  if (newTab || isFramed()) window.open(url, "_blank", "noopener,noreferrer");
  else window.location.assign(url);
}

/** AI 用不了时"改用搜索引擎搜"用哪个引擎：默认引擎，如果默认就是 AI 则用第一个普通引擎 */
export function fallbackEngine() {
  const settings = store.get();
  const web = listEngines(settings).filter((e) => !e.ai);
  return web.find((e) => e.id === settings.search.engine) || web[0];
}

export function initSearch({ onAsk, onAddEngine }) {
  const form = $("#search");
  const input = $("#q");
  const clearBtn = $("#q-clear");
  const goBtn = $("#q-go");
  const badge = $("#engine-badge");
  const badgeMark = $("#badge-mark");
  const menu = $("#engine-menu");
  const pop = $("#history-pop");
  const listEl = $("#history");

  let engines = [];
  let currentId = "";
  let items = []; // 下拉里正显示的历史
  let activeIndex = -1; // 键盘选中的那一条

  const current = () => engines.find((e) => e.id === currentId) || engines[0];

  // ---------- 引擎：点搜索框左边的标记，弹出菜单切换 ----------
  const isDesktop = () => matchMedia("(hover: hover) and (pointer: fine)").matches;

  function markFor(engine) {
    return engine.ai ? icon("sparkles") : engine.mark;
  }

  function renderEngines() {
    const settings = store.get();
    engines = listEngines(settings);
    const wanted = settings.search.remember && settings.search.last ? settings.search.last : settings.search.engine;
    if (!engines.some((e) => e.id === currentId)) currentId = engines.some((e) => e.id === wanted) ? wanted : engines[0].id;

    menu.replaceChildren(
      ...engines.map((engine) =>
        h(
          "button",
          {
            type: "button",
            class: `engine-item${engine.ai ? " is-ai" : ""}`,
            role: "menuitemradio",
            "aria-checked": "false",
            tabindex: "-1",
            dataset: { id: engine.id },
            title: engine.bangs.length ? `也可以直接输入：!${engine.bangs[0]} 关键词` : null,
          },
          h("span", { class: `engine-mark${engine.ai ? " is-ai" : ""}`, "aria-hidden": "true" }, markFor(engine)),
          h("span", { class: "engine-name" }, engine.name),
          icon("check")
        )
      ),
      h("hr", { role: "separator" }),
      h("button", { type: "button", class: "engine-item engine-add", role: "menuitem", tabindex: "-1", dataset: { add: "1" } }, h("span", { class: "engine-mark", "aria-hidden": "true" }, icon("plus")), h("span", { class: "engine-name" }, "添加搜索引擎…"))
    );
    paintCurrent();
  }

  function paintCurrent() {
    const engine = current();
    for (const item of menu.querySelectorAll('[role="menuitemradio"]')) item.setAttribute("aria-checked", String(item.dataset.id === engine.id));
    form.dataset.ai = String(!!engine.ai);
    badgeMark.replaceChildren(markFor(engine));
    badge.setAttribute("aria-label", `搜索引擎：${engine.name}，点击切换`);
    input.placeholder = engine.ai ? "问 AI 任何问题…" : `用 ${engine.name} 搜索…`;
    goBtn.setAttribute("aria-label", engine.ai ? "问 AI" : "搜索");
    goBtn.replaceChildren(icon(engine.ai ? "sparkles" : "search"));
  }

  function setEngine(id) {
    if (!engines.some((e) => e.id === id)) return;
    currentId = id;
    paintCurrent();
    // 记住上次的选择（包括 AI）
    if (store.get().search.last !== id) store.update((s) => (s.search.last = id));
    announce(`已切换到 ${current().name}`);
  }

  function cycleEngine(step) {
    const i = engines.findIndex((e) => e.id === currentId);
    setEngine(engines[(i + step + engines.length) % engines.length].id);
  }

  const menuOpen = () => !menu.hidden;
  const menuItems = () => [...menu.querySelectorAll(".engine-item")];

  function openMenu() {
    closeHistory();
    menu.hidden = false;
    badge.setAttribute("aria-expanded", "true");
    // 菜单不要超出可见区域（手机软键盘弹出时可见区域会变小）
    const visible = window.visualViewport ? visualViewport.height : window.innerHeight;
    menu.style.maxHeight = Math.max(180, visible - form.getBoundingClientRect().bottom - 16) + "px";
    (menu.querySelector('[aria-checked="true"]') || menuItems()[0]).focus();
  }

  /** focusTarget：关闭后把焦点交给谁（不传就不动焦点） */
  function closeMenu(focusTarget) {
    if (!menuOpen()) return;
    menu.hidden = true;
    badge.setAttribute("aria-expanded", "false");
    focusTarget?.focus();
  }

  badge.addEventListener("click", () => (menuOpen() ? closeMenu(badge) : openMenu()));
  badge.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && !menuOpen()) {
      e.preventDefault();
      openMenu();
    }
  });

  menu.addEventListener("click", (e) => {
    const item = e.target.closest(".engine-item");
    if (!item) return;
    if (item.dataset.add) {
      closeMenu();
      return onAddEngine();
    }
    setEngine(item.dataset.id);
    // 有键盘鼠标的设备上，选完直接回到输入框；手机上不主动弹键盘
    closeMenu(isDesktop() ? input : badge);
  });

  // 菜单的键盘操作：上下键移动，Home/End 到首尾，Esc 关闭
  menu.addEventListener("keydown", (e) => {
    const list = menuItems();
    const index = list.indexOf(document.activeElement);
    const move = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: list.length - 1 }[e.key];
    if (move !== undefined) {
      e.preventDefault();
      list[(move + list.length) % list.length].focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeMenu(badge);
    } else if (e.key === "Tab") {
      closeMenu(); // 让 Tab 照常把焦点移走
    }
  });

  // 点菜单以外的地方、或焦点离开搜索区域时，收起菜单
  document.addEventListener("pointerdown", (e) => {
    if (menuOpen() && !menu.contains(e.target) && !badge.contains(e.target)) closeMenu();
  });

  // ---------- 历史下拉 ----------
  function isOpen() {
    return !pop.hidden;
  }

  function closeHistory() {
    pop.hidden = true;
    activeIndex = -1;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }

  function openHistory() {
    closeMenu();
    if (!store.get().search.history) return closeHistory();
    const typed = input.value.trim().toLowerCase();
    items = searchHistory
      .list()
      .filter((x) => !typed || (x.toLowerCase().includes(typed) && x.toLowerCase() !== typed))
      .slice(0, HISTORY_SHOW);
    if (!items.length) return closeHistory();

    activeIndex = -1;
    listEl.replaceChildren(
      ...items.map((text, i) =>
        h(
          "li",
          { class: "history-item", role: "option", id: `history-${i}`, "aria-selected": "false", dataset: { index: String(i) } },
          icon("history"),
          h("span", { class: "history-text" }, text),
          iconButton("x", `从历史中删除“${text}”`, { class: "history-remove", tabindex: "-1", dataset: { remove: String(i) } })
        )
      )
    );
    pop.hidden = false;
    input.setAttribute("aria-expanded", "true");
    // 下拉不要超出可见区域（手机软键盘弹出时可见区域会变小）
    const visible = window.visualViewport ? visualViewport.height : window.innerHeight;
    const room = visible - form.getBoundingClientRect().bottom - 16;
    pop.style.maxHeight = Math.max(150, room) + "px";
  }

  function setActive(index) {
    activeIndex = index;
    listEl.querySelectorAll(".history-item").forEach((li, i) => {
      const on = i === index;
      li.classList.toggle("is-active", on);
      li.setAttribute("aria-selected", String(on));
      if (on) li.scrollIntoView({ block: "nearest" });
    });
    if (index >= 0) input.setAttribute("aria-activedescendant", `history-${index}`);
    else input.removeAttribute("aria-activedescendant");
  }

  function removeHistoryAt(index) {
    searchHistory.remove(items[index]);
    announce("已从历史中删除");
    openHistory();
  }

  // 在下拉里按下鼠标时，不要让输入框失去焦点
  pop.addEventListener("mousedown", (e) => e.preventDefault());
  pop.addEventListener("click", (e) => {
    const removeBtn = e.target.closest("[data-remove]");
    if (removeBtn) return removeHistoryAt(Number(removeBtn.dataset.remove));
    const li = e.target.closest(".history-item");
    if (li) {
      input.value = items[Number(li.dataset.index)];
      submit();
    }
  });
  $("#history-clear").addEventListener("click", () => {
    searchHistory.clear();
    closeHistory();
    announce("搜索历史已清空");
    input.focus();
  });

  // ---------- 提交 ----------
  function submit() {
    const raw = input.value.trim();
    if (!raw) {
      if (current().ai) onAsk(""); // AI 模式下空着回车：重新打开对话面板，接着之前的聊
      return;
    }
    const parsed = parseBang(raw, engines);
    const engine = parsed.engine || current();
    const query = parsed.query;
    if (!query) return;
    const settings = store.get();
    if (settings.search.history) searchHistory.add(query);
    closeHistory();
    if (engine.ai) {
      onAsk(query);
      input.value = "";
      syncClear();
    } else {
      // 关键词直接发给搜索引擎，不经过本站
      openUrl(buildSearchUrl(engine, query), settings.linkTarget === "new");
    }
  }

  function syncClear() {
    clearBtn.hidden = !input.value;
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (activeIndex >= 0) input.value = items[activeIndex];
    submit();
  });

  clearBtn.addEventListener("click", () => {
    input.value = "";
    syncClear();
    closeHistory();
    input.focus();
  });

  input.addEventListener("input", () => {
    syncClear();
    openHistory();
  });
  // 用户主动点输入框时才展开历史；页面自动聚焦时不展开，免得挡住下面的内容
  input.addEventListener("click", () => {
    if (!isOpen()) openHistory();
  });
  form.addEventListener("focusout", (e) => {
    if (form.contains(e.relatedTarget)) return;
    closeHistory();
    closeMenu();
  });

  input.addEventListener("keydown", (e) => {
    if (e.isComposing) return; // 中文输入法选字时不要抢按键
    if (e.key === "Tab" && !e.ctrlKey && !e.altKey && !e.metaKey && store.get().search.tabSwitch) {
      e.preventDefault(); // Tab 切换引擎；想离开输入框先按 Esc
      cycleEngine(e.shiftKey ? -1 : 1);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!isOpen()) {
        openHistory();
        if (!isOpen()) return;
      }
      e.preventDefault();
      const n = items.length;
      const step = e.key === "ArrowDown" ? 1 : -1;
      // 在"没选中"和各条历史之间循环
      setActive(((activeIndex + 1 + step + (n + 1)) % (n + 1)) - 1);
    } else if (e.key === "Delete" && e.shiftKey && activeIndex >= 0) {
      e.preventDefault();
      removeHistoryAt(activeIndex);
    } else if (e.key === "Escape") {
      if (isOpen()) closeHistory();
      else input.blur(); // 离开输入框，之后 Tab 键恢复正常的焦点移动
      e.preventDefault();
    }
  });

  // 全局快捷键：按 / 聚焦搜索框
  document.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.ctrlKey || e.altKey || e.metaKey || isModalOpen()) return;
    const t = e.target;
    if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    e.preventDefault();
    input.focus();
    input.select();
  });

  // 手机软键盘弹出后，如果搜索框被挡住，就把它滚回可见区域
  window.visualViewport?.addEventListener("resize", () => {
    if (document.activeElement !== input) return;
    const rect = form.getBoundingClientRect();
    if (rect.bottom > visualViewport.height || rect.top < 0) form.scrollIntoView({ block: "center" });
  });

  // 从搜索结果页"后退"回来时，选中上次的关键词，方便直接改
  window.addEventListener("pageshow", (e) => {
    syncClear();
    if (e.persisted && input.value && isDesktop()) input.select();
  });

  // ---------- 启动 ----------
  let lastSignature = "";
  function onSettings(settings) {
    // 引擎列表或默认引擎变了才重画，避免无关设置变化时打断操作
    const sig = JSON.stringify([settings.search.custom, settings.search.engine, settings.search.remember]);
    if (sig !== lastSignature) {
      const defaultChanged = lastSignature && JSON.parse(lastSignature)[1] !== settings.search.engine;
      lastSignature = sig;
      if (defaultChanged) currentId = settings.search.engine; // 在设置里改了默认引擎，立刻切过去
      renderEngines();
    }
    if (!settings.search.history) closeHistory();
  }
  onSettings(store.get());
  store.subscribe(onSettings);
  syncClear();

  // 桌面端打开页面自动聚焦；手机端不自动聚焦，避免一打开就弹出键盘
  if (isDesktop()) input.focus({ preventScroll: true });

  return {
    focus: () => input.focus(),
    /** 用指定关键词和普通搜索引擎搜（AI 用不了时的退路） */
    searchWeb(query) {
      openUrl(buildSearchUrl(fallbackEngine(), query), true);
    },
  };
}
