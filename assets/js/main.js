// 起始页入口：把各个模块串起来。
// 设置面板、AI 面板、导航编辑这些不是一打开就要用的功能，点到时才加载，保证首屏快。
import { store } from "./store.js";
import { initBackground } from "./background.js";
import { initClock } from "./widgets.js";
import { initSearch, openUrl } from "./search.js";
import { initNav } from "./nav.js";
import { aiMode, catgptUrl } from "./ai/link.js";
import { $, h, toast } from "./ui.js";

const root = document.documentElement;

// ---------- 主题：深色 / 浅色 / 跟随系统 ----------
const systemLight = matchMedia("(prefers-color-scheme: light)");
function applyTheme() {
  const choice = store.get().theme;
  root.dataset.theme = choice === "system" ? (systemLight.matches ? "light" : "dark") : choice;
}
applyTheme();
store.subscribe(applyTheme);
systemLight.addEventListener("change", applyTheme);

// ---------- 手机软键盘：记录"真正可见"的高度，供弹窗布局用 ----------
function syncViewport() {
  const vv = window.visualViewport;
  root.style.setProperty("--vvh", (vv ? vv.height : window.innerHeight) + "px");
}
syncViewport();
window.visualViewport?.addEventListener("resize", syncViewport);
window.addEventListener("resize", syncViewport);

// ---------- 背景、时钟 ----------
initBackground();
initClock();

// ---------- 设置面板 ----------
async function openSettings(section) {
  try {
    const { openSettingsPanel } = await import("./settings-panel.js");
    openSettingsPanel(section);
  } catch {
    toast("设置面板加载失败，请检查网络后重试");
  }
}
$("#btn-settings").addEventListener("click", () => openSettings());

// ---------- 搜索 + AI ----------
const search = initSearch({
  onAsk: async (question) => {
    // 只配置了 catgpt 页面地址：不弹面板，直接带着问题跳过去（?q=问题）
    // 这一步必须紧跟在用户的点击/回车之后同步执行，否则可能被浏览器当成弹窗拦截
    if (aiMode() === "jump") {
      if (question) openUrl(catgptUrl(question), store.get().linkTarget === "new");
      return;
    }
    try {
      const { askAI } = await import("./ai/panel.js");
      askAI(question, { searchWeb: search.searchWeb });
    } catch {
      toast("AI 面板加载失败，已改用搜索引擎");
      search.searchWeb(question);
    }
  },
  onAddEngine: () => openSettings("search"),
});

// ---------- 导航 ----------
// 配置文件单独加载：万一里面有笔误，也只影响导航，搜索等功能照常可用
import("../../config/nav.js")
  .then((mod) => initNav(mod.default))
  .catch((err) => {
    console.error("config/nav.js 加载失败：", err);
    $("#nav").replaceChildren(
      h("p", { class: "notice glass", role: "alert" }, "导航配置文件 config/nav.js 有格式错误（常见原因：漏了逗号或引号），请检查最近的修改。")
    );
  });

// ---------- PWA：注册 Service Worker（支持"添加到主屏幕"和离线打开） ----------
// 浏览器只允许在 https 网站（或本机调试）上使用
const isSecure = location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname);
if ("serviceWorker" in navigator && isSecure) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {
      /* 注册失败不影响正常使用 */
    });
  });
}
