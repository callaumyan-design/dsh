// 行情卡片的"开关"：轻点页面空白处，或者（电脑上）焦点不在输入框时按 M。
// 主界面上没有任何按钮或提示。卡片本身（card.js）第一次打开时才加载，不拖慢首屏。
//
// 什么算"轻点空白处"：
//   - 按下和松开都落在背景本身上（页面、主体区域），按钮、输入框、链接、时钟、搜索框、导航（含图标之间的缝隙）都不算；
//   - 手指 / 鼠标移动不到 10 像素、按住不到半秒；拖动、长按、选字、两根手指都不算。
//   - 用 pointer 事件自己判断，不靠 click：iOS Safari 在不可点击的元素上不一定发出 click。
// 什么时候第一下不打开：
//   - 引擎菜单、搜索历史开着：第一下只把它们关掉；
//   - 搜索框里正在输入（手机键盘弹着）：第一下只收起键盘；
//   - 导航编辑模式、设置面板等弹窗开着、设置里关掉了行情卡片：完全不响应。
import { store } from "../store.js";
import { $, toast, isModalOpen } from "../ui.js";

const MOVE = 10; // 像素
const HOLD = 500; // 毫秒

/** 这些东西上面（以及里面）点了都不算空白处 */
// （导航那一整排图标——包括图标之间的缝隙——都不算；排在图标上方的那段空白算）
const NOT_BLANK = "a, button, input, textarea, select, label, summary, [contenteditable], [role=button], [tabindex]:not([tabindex='-1']), dialog, .topbar, #clock, .search, .dock, .nav-group, .wall-credit, .toasts, .notice, .skip-link";

function isBlank(el) {
  if (!(el instanceof Element)) return false;
  if (el.closest(NOT_BLANK)) return false;
  return el === document.documentElement || el === document.body || el.matches("main, .hero, #nav, #bg, #bg *");
}

const isTyping = (el) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
const allowed = () => store.get().market.enabled && !document.body.classList.contains("editing") && !isModalOpen();

let loading = null;
/** 打开卡片。returnTo：关掉卡片后焦点回到哪里 */
export async function openMarket(returnTo = document.activeElement) {
  try {
    loading ||= import("./card.js");
    await (await loading).openMarketCard({ returnTo });
  } catch {
    loading = null;
    toast("行情卡片加载失败，请检查网络后重试");
  }
}

export function initMarketTrigger() {
  let down = null;
  let touches = 0;

  // 用"捕获"阶段：要赶在搜索框的代码把菜单关掉之前，记下按下时菜单是不是开着
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType === "touch") touches++;
      if (!e.isPrimary || touches > 1 || (e.pointerType === "mouse" && e.button !== 0)) {
        down = null; // 第二根手指、右键都不算
        return;
      }
      const active = document.activeElement;
      down = {
        x: e.clientX,
        y: e.clientY,
        t: e.timeStamp,
        target: e.target,
        mouse: e.pointerType === "mouse",
        popover: !$("#engine-menu")?.hidden || !$("#history-pop")?.hidden,
        typing: isTyping(active) ? active : null,
      };
    },
    true
  );
  const release = (e) => {
    if (e.pointerType === "touch") touches = Math.max(0, touches - 1);
  };
  document.addEventListener("pointercancel", (e) => {
    release(e);
    down = null;
  }, true);
  document.addEventListener(
    "pointerup",
    (e) => {
      release(e);
      const d = down;
      down = null;
      if (!d || !e.isPrimary) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) >= MOVE || e.timeStamp - d.t >= HOLD) return;
      if (!isBlank(d.target) || !isBlank(e.target) || !allowed()) return;
      // 弹层开着、或者正在输入：第一下只收起它们（手机上点空白处不会自动收起键盘，要帮它收）
      if (d.popover || (d.typing && (!d.mouse || d.typing.value))) {
        if (d.typing && document.activeElement === d.typing) d.typing.blur();
        return;
      }
      const selection = window.getSelection?.();
      if (selection && !selection.isCollapsed && String(selection).trim()) return; // 在选字
      openMarket(document.activeElement);
    },
    true
  );

  // 电脑上：焦点不在输入框时按 M
  document.addEventListener("keydown", (e) => {
    if ((e.key !== "m" && e.key !== "M") || e.ctrlKey || e.metaKey || e.altKey || e.isComposing || e.repeat) return;
    if (isTyping(e.target) || !allowed()) return;
    e.preventDefault();
    openMarket(document.activeElement);
  });
}
