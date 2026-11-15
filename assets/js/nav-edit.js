// 导航的编辑模式：拖动排序、隐藏/显示、添加/修改/删除自定义入口、恢复默认。
// 所有改动只保存在这台设备的浏览器里，不会改动 config/nav.js。
import { navState, groupNames } from "./nav.js";
import { normalizeEntry, DEFAULT_GROUP } from "./nav-model.js";
import { ICONS } from "./icons.js";
import { uid } from "./store.js";
import { $, h, icon, iconButton, toast, announce, openDialog, confirmDialog } from "./ui.js";

export function createEditor({ exit }) {
  // ---------- 顶部工具条 ----------
  const bar = h(
    "div",
    { class: "edit-bar glass", role: "toolbar", "aria-label": "编辑导航" },
    h("p", null, "编辑模式：按住左侧把手拖动排序（键盘用方向键），点眼睛隐藏。改动只保存在本机。"),
    h("button", { type: "button", class: "btn", onclick: () => openEntryForm() }, icon("plus"), "添加入口"),
    h("button", { type: "button", class: "btn", onclick: resetAll }, icon("rotate-ccw"), "恢复默认"),
    h("button", { type: "button", class: "btn btn-primary", onclick: exit }, icon("check"), "完成")
  );

  async function resetAll() {
    const ok = await confirmDialog({
      title: "恢复默认导航？",
      message: "排序和隐藏会还原，你自己添加的入口会被删除。这个操作不能撤销。",
      okText: "恢复默认",
      danger: true,
    });
    if (ok) {
      navState.reset();
      toast("导航已恢复默认");
    }
  }

  /** 重画之后把焦点还给同一张卡片上的同一个按钮 */
  function refocus(id, selector) {
    $(`#nav .card-wrap[data-id="${CSS.escape(id)}"] ${selector}`)?.focus();
  }

  /** 把页面上现在的顺序存下来 */
  function saveOrder() {
    const order = [...document.querySelectorAll("#nav .card-wrap")].map((li) => li.dataset.id);
    navState.set({ ...navState.get(), order }, { rerender: false });
  }

  // ---------- 给每张卡片加上编辑用的按钮 ----------
  function decorate(li, link, entry) {
    // 编辑时卡片本身不能点开
    link.setAttribute("aria-disabled", "true");
    link.tabIndex = -1;
    link.addEventListener("click", (e) => e.preventDefault());
    link.draggable = false;

    const handle = iconButton("grip-vertical", `移动“${entry.name}”：拖动，或按方向键`, { class: "drag-handle" });
    handle.addEventListener("pointerdown", (e) => startDrag(e, li, handle));
    handle.addEventListener("keydown", (e) => moveByKey(e, li, handle, entry));

    const tools = h("div", { class: "card-tools" });
    if (entry.custom) {
      tools.append(
        iconButton("pencil", `修改“${entry.name}”`, { class: "tool-edit", onclick: () => openEntryForm(entry) }),
        iconButton("trash-2", `删除“${entry.name}”`, { class: "tool-delete", onclick: () => removeEntry(entry) })
      );
    }
    tools.append(
      iconButton(entry.hidden ? "eye-off" : "eye", entry.hidden ? `显示“${entry.name}”` : `隐藏“${entry.name}”`, {
        class: "tool-hide",
        "aria-pressed": String(entry.hidden),
        onclick: () => toggleHidden(entry),
      })
    );
    li.append(handle, tools);
  }

  function toggleHidden(entry) {
    const s = navState.get();
    const hidden = entry.hidden ? s.hidden.filter((id) => id !== entry.id) : [...s.hidden, entry.id];
    navState.set({ ...s, hidden });
    refocus(entry.id, ".tool-hide");
    announce(entry.hidden ? `已显示 ${entry.name}` : `已隐藏 ${entry.name}`);
  }

  async function removeEntry(entry) {
    const ok = await confirmDialog({ title: "删除这个入口？", message: `“${entry.name}”会从导航里删除。`, okText: "删除", danger: true });
    if (!ok) return;
    const s = navState.get();
    navState.set({
      ...s,
      custom: s.custom.filter((c) => c.id !== entry.id),
      order: s.order.filter((id) => id !== entry.id),
      hidden: s.hidden.filter((id) => id !== entry.id),
    });
    toast("已删除");
  }

  // ---------- 键盘排序 ----------
  function moveByKey(e, li, handle, entry) {
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const grid = li.parentElement;
    const sibling = step < 0 ? li.previousElementSibling : li.nextElementSibling;
    if (!sibling) return;
    if (step < 0) grid.insertBefore(li, sibling);
    else grid.insertBefore(sibling, li);
    handle.focus();
    saveOrder();
    const position = [...grid.children].indexOf(li) + 1;
    announce(`${entry.name} 已移到第 ${position} 位，共 ${grid.children.length} 个`);
  }

  // ---------- 拖动排序（鼠标和手指都能用） ----------
  function startDrag(e, li, handle) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    const grid = li.parentElement;
    const rect = li.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;

    // 跟着手指走的"影子"
    const ghost = li.cloneNode(true);
    ghost.classList.add("drag-ghost");
    ghost.style.width = rect.width + "px";
    ghost.style.height = rect.height + "px";
    ghost.setAttribute("aria-hidden", "true");
    document.body.append(ghost);
    li.classList.add("is-dragging");

    let x = e.clientX;
    let y = e.clientY;
    let frame = 0;
    const place = () => (ghost.style.transform = `translate(${x - offsetX}px, ${y - offsetY}px)`);
    place();

    function reorder() {
      const target = document.elementFromPoint(x, y)?.closest(".card-wrap");
      if (!target || target === li || target.parentElement !== grid) return;
      const r = target.getBoundingClientRect();
      // 一列（手机）按上下判断，多列按左右判断
      const singleColumn = r.width > grid.clientWidth * 0.75;
      const before = singleColumn ? y < r.top + r.height / 2 : x < r.left + r.width / 2;
      grid.insertBefore(li, before ? target : target.nextSibling);
    }

    // 拖到屏幕上下边缘时自动滚动页面
    function tick() {
      const edge = 70;
      if (y < edge) window.scrollBy(0, -10);
      else if (y > window.innerHeight - edge) window.scrollBy(0, 10);
      reorder();
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);

    function onMove(ev) {
      x = ev.clientX;
      y = ev.clientY;
      place();
    }
    function onEnd() {
      cancelAnimationFrame(frame);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onEnd);
      handle.removeEventListener("pointercancel", onEnd);
      ghost.remove();
      li.classList.remove("is-dragging");
      saveOrder();
    }
    handle.setPointerCapture(e.pointerId);
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onEnd);
    handle.addEventListener("pointercancel", onEnd);
  }

  // ---------- 添加 / 修改入口的表单 ----------
  function openEntryForm(entry) {
    const editing = !!entry;
    const name = h("input", { class: "input", required: true, maxLength: 40, value: entry?.name || "", autocomplete: "off" });
    const url = h("input", {
      class: "input",
      type: "url",
      required: true,
      inputMode: "url",
      placeholder: "https://example.com/",
      value: entry?.url || "",
      autocomplete: "off",
      autocapitalize: "off",
      spellcheck: false,
    });
    const desc = h("input", { class: "input", maxLength: 80, value: entry?.desc || "", autocomplete: "off" });
    const group = h("input", {
      class: "input",
      maxLength: 20,
      value: entry?.group || DEFAULT_GROUP,
      list: "group-options",
      autocomplete: "off",
    });
    const groupOptions = h("datalist", { id: "group-options" }, groupNames().map((g) => h("option", { value: g })));
    const iconInput = h("input", {
      class: "input",
      maxLength: 300,
      value: entry?.icon || "",
      placeholder: "点下面选一个，或填图片地址 / 表情",
      autocomplete: "off",
      autocapitalize: "off",
      spellcheck: false,
    });
    const newTab = h("input", { type: "checkbox", checked: entry ? entry.newTab : true });
    const error = h("p", { class: "error-text", role: "alert", hidden: true });

    // 图标选择器：本地图标库
    const picker = h(
      "div",
      { class: "icon-picker", role: "group", "aria-label": "选择图标" },
      Object.keys(ICONS).map((key) =>
        h("button", { type: "button", "aria-label": key, title: key, "aria-pressed": String(key === iconInput.value), dataset: { icon: key } }, icon(key))
      )
    );
    const syncPicker = () => picker.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.icon === iconInput.value.trim())));
    picker.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      iconInput.value = btn.dataset.icon;
      syncPicker();
    });
    iconInput.addEventListener("input", syncPicker);

    const form = h(
      "form",
      { class: "modal-body", novalidate: true },
      h("h2", null, editing ? "修改入口" : "添加入口"),
      h("p", { class: "hint" }, "这个入口只保存在你这台设备的浏览器里，别人看不到。"),
      h("label", { class: "field" }, h("span", null, "名称"), name),
      h("label", { class: "field" }, h("span", null, "网址"), url),
      h("label", { class: "field" }, h("span", null, "一句话描述（可不填）"), desc),
      h("label", { class: "field" }, h("span", null, "分组"), group),
      groupOptions,
      h("div", { class: "field" }, h("label", null, h("span", { class: "field-label" }, "图标（可不填，默认用名称的第一个字）"), iconInput), picker),
      h("div", { class: "set-row" }, h("label", { for: "entry-newtab" }, "在新标签页打开"), h("label", { class: "switch" }, newTab, h("span"))),
      error,
      h(
        "div",
        { class: "modal-actions" },
        h("button", { type: "button", class: "btn", onclick: () => dialog.close() }, "取消"),
        h("button", { type: "submit", class: "btn btn-primary" }, editing ? "保存" : "添加")
      )
    );
    newTab.id = "entry-newtab";
    const dialog = h("dialog", { class: "modal", "aria-label": editing ? "修改入口" : "添加入口" }, form);
    dialog.addEventListener("close", () => dialog.remove());

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      // 没写 http:// 的，自动补上 https://
      let address = url.value.trim();
      if (address && !/^[a-z][a-z0-9+.-]*:/i.test(address) && !/^[./]/.test(address)) address = "https://" + address;
      const next = normalizeEntry(
        {
          id: entry?.id || uid("c:"),
          name: name.value,
          url: address,
          desc: desc.value,
          group: group.value,
          icon: iconInput.value,
          newTab: newTab.checked,
        },
        { custom: true }
      );
      if (!next) {
        error.textContent = name.value.trim() ? "网址不对：请填 http:// 或 https:// 开头的地址。" : "请填写名称。";
        error.hidden = false;
        (name.value.trim() ? url : name).focus();
        return;
      }
      const s = navState.get();
      const custom = editing ? s.custom.map((c) => (c.id === next.id ? next : c)) : [...s.custom, next];
      navState.set({ ...s, custom });
      dialog.close();
      toast(editing ? "已保存" : "已添加");
      refocus(next.id, editing ? ".tool-edit" : ".drag-handle");
    });

    openDialog(dialog);
    name.focus();
  }

  return { bar, decorate };
}
