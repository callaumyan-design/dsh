// 界面小工具：创建元素、图标、提示条、确认框
import { ICONS } from "./icons.js";

const SVG_NS = "http://www.w3.org/2000/svg";

export const $ = (sel, root = document) => root.querySelector(sel);

/**
 * 创建元素。用法：h("button", { class: "btn", onclick: fn }, "文字")
 * 文字一律按纯文本插入，不会被当成 HTML 执行。
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null) continue; // 不需要的属性传 null 即可
      if (key === "class") el.className = value;
      else if (key === "dataset") Object.assign(el.dataset, value);
      else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
      else if (key in el && !key.startsWith("aria") && key !== "role" && key !== "list") el[key] = value;
      else if (value !== false) el.setAttribute(key, value === true ? "" : String(value));
    }
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** 本地图标库里的图标，返回一个 <svg> 元素 */
export function icon(name) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = ICONS[name] || ICONS["circle-help"]; // 内容只来自本地图标库
  return svg;
}

export const hasIcon = (name) => Object.prototype.hasOwnProperty.call(ICONS, name);

/** 只放一个图标的圆形按钮 */
export function iconButton(name, label, props = {}) {
  const { class: cls, ...rest } = props;
  return h(
    "button",
    { type: "button", class: `icon-btn${cls ? " " + cls : ""}`, "aria-label": label, title: label, ...rest },
    icon(name)
  );
}

let toastBox = null;

/** 底部提示条，几秒后自动消失 */
export function toast(message, ms = 3200) {
  toastBox ||= $("#toasts") || h("div", { class: "toasts", role: "status", "aria-live": "polite" });
  // 有弹窗开着时，提示条要放进最上面的弹窗里，否则会被弹窗盖住看不见
  const host = [...document.querySelectorAll("dialog[open]")].pop() || document.body;
  if (toastBox.parentElement !== host) host.append(toastBox);
  const item = h("div", { class: "toast" }, message);
  toastBox.append(item);
  setTimeout(() => item.remove(), ms);
}

/** 打开一个原生 <dialog>：自带焦点管理和 Esc 关闭；点遮罩也能关 */
export function openDialog(dialog) {
  if (!dialog.isConnected) document.body.append(dialog);
  if (!dialog.dataset.wired) {
    dialog.dataset.wired = "1";
    // 按下和松开都落在遮罩上才算"点遮罩"，避免拖选文字时误关
    let downOnBackdrop = false;
    dialog.addEventListener("pointerdown", (e) => (downOnBackdrop = e.target === dialog));
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog && downOnBackdrop) dialog.close();
    });
  }
  if (!dialog.open) dialog.showModal();
  return dialog;
}

/** 确认框，返回 Promise<boolean> */
export function confirmDialog({ title, message, okText = "确定", danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    const ok = h(
      "button",
      {
        type: "button",
        class: `btn ${danger ? "btn-danger" : "btn-primary"}`,
        onclick: () => {
          result = true;
          dialog.close();
        },
      },
      okText
    );
    const cancel = h("button", { type: "button", class: "btn", onclick: () => dialog.close() }, "取消");
    const dialog = h(
      "dialog",
      { class: "modal", "aria-label": title },
      h("div", { class: "modal-body" }, h("h2", null, title), h("p", null, message), h("div", { class: "modal-actions" }, cancel, ok))
    );
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(result);
    });
    openDialog(dialog);
    cancel.focus(); // 默认焦点放在"取消"上，防止手滑
  });
}

/** 本页是不是被嵌在别的页面里（比如预览窗格）。嵌着的时候，站外网页只能在新标签页打开 */
export function isFramed() {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/** 是否正有弹窗开着（全局快捷键要避开） */
export const isModalOpen = () => !!document.querySelector("dialog[open]");

/** 把文字读给读屏软件听 */
export function announce(text) {
  const live = $("#live");
  if (live) live.textContent = text;
}

/** 让浏览器下载一个文本文件 */
export function downloadText(filename, text, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
