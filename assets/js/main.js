// 起始页入口：把各个模块串起来。
// 设置面板、AI 面板、导航编辑这些不是一打开就要用的功能，点到时才加载，保证首屏快。
import { store } from "./store.js";
import { initBackground } from "./background.js";
import { initClock } from "./widgets.js";
import { initTypography } from "./typography.js";
import { initSearch, openUrl } from "./search.js";
import { initNav } from "./nav.js";
import { aiMode, catgptUrl } from "./ai/link.js";
import { $, h, toast, isFramed, BUILD } from "./ui.js";

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

// ---------- 文字、背景、时钟 ----------
initTypography();
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
      askAI(question, { searchWeb: search.searchWeb, openSettings });
    } catch {
      toast("AI 面板加载失败，已改用搜索引擎");
      search.searchWeb(question);
    }
  },
  onAddEngine: () => openSettings("search"),
});

// ---------- 行情：搜索框下面的一块 ----------
// 代码单独加载（不挡页面出来）；设置里关掉时不加载，之后再打开时才加载
let marketLoading = null;
function startMarket() {
  if (marketLoading || !store.get().market.enabled) return;
  marketLoading = import("./market/panel.js")
    .then((mod) => mod.initMarket())
    .catch((err) => {
      marketLoading = null;
      console.error("行情加载失败：", err);
    });
}
startMarket();
store.subscribe(startMarket);

// ---------- 导航 ----------
// 配置文件单独加载：万一里面有笔误，也只影响导航，搜索等功能照常可用
import("../../config/nav.js")
  .then((mod) => initNav(mod.default))
  .catch((err) => {
    console.error("config/nav.js 加载失败：", err);
    $("#nav").hidden = false;
    $("#nav").replaceChildren(
      h("p", { class: "notice glass", role: "alert" }, "导航配置文件 config/nav.js 有格式错误（常见原因：漏了逗号或引号），请检查最近的修改。")
    );
  });

// ---------- 发现有新版本就自动刷新一次 ----------
// 首页里写着自己的版本号（发布时写入）。页面可能是很久以前打开、一直留在后台的，
// 也可能是浏览器从缓存里恢复出来的旧页面：这时问一下服务器现在是哪一版，不一样就重新加载。
const hasBuild = !!BUILD; // 本机预览时没有版本号，不检查
let lastBuildCheck = 0;

async function checkForNewBuild() {
  // 明确没网时不问；一分钟内也不重复问
  if (!hasBuild || navigator.onLine === false || Date.now() - lastBuildCheck < 60 * 1000) return;
  lastBuildCheck = Date.now();
  let latest = "";
  try {
    const res = await fetch("./api/build", { cache: "no-store" });
    if (res.ok) latest = (await res.json()).build;
  } catch {
    return; // 没网或者问不到，就算了
  }
  if (typeof latest !== "string" || !/^[A-Za-z0-9]{1,40}$/.test(latest) || latest === BUILD) return;
  // 正在输入、或者开着设置 / 对话面板时不打断，等下次回到页面再说
  if (document.querySelector("dialog[open]") || $("#q").value) return (lastBuildCheck = 0);
  // 同一个新版本只自动刷新一次：万一刷新后拿到的还是旧页面，也不会没完没了地刷新
  try {
    if (sessionStorage.getItem("sp:reloaded-for") === latest) return;
    sessionStorage.setItem("sp:reloaded-for", latest);
  } catch {
    return; // 记不下"已经刷新过"，就不冒险
  }
  location.reload();
}
if (hasBuild) {
  (window.requestIdleCallback || ((fn) => setTimeout(fn, 800)))(() => checkForNewBuild());
  // 从后台切回来、或者浏览器把之前的页面原样恢复出来时，再检查一次
  window.addEventListener("pageshow", (e) => e.persisted && checkForNewBuild());
  document.addEventListener("visibilitychange", () => !document.hidden && checkForNewBuild());
}

// ---------- PWA：注册 Service Worker（支持"添加到主屏幕"和离线打开） ----------
// 浏览器只允许在 https 网站（或本机调试）上使用
const isSecure = location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname);
// 被嵌在别的页面里（比如预览窗格）时不注册：那种环境本来就不支持
if ("serviceWorker" in navigator && isSecure && !isFramed()) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {
      /* 注册失败不影响正常使用 */
    });
    // 告诉"离线助手"现在是哪一版，让它把这一版的文件存好（断网时才打得开），并清掉旧版本的
    if (hasBuild) navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage({ type: "store-build", build: BUILD })).catch(() => {});
  });
}
