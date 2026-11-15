// 首屏防闪烁：在页面开始绘制之前，先把主题（深/浅色）和背景占位定下来。
// 这个文件故意写得很小、同步执行，放在 <head> 里最先加载。
(function () {
  var root = document.documentElement;
  var theme = "system";
  var cache = null;
  try {
    var saved = JSON.parse(localStorage.getItem("sp:settings") || "null");
    if (saved && (saved.theme === "light" || saved.theme === "dark")) theme = saved.theme;
    cache = JSON.parse(localStorage.getItem("sp:bg-cache") || "null");
  } catch (e) {
    /* 读不到本地存储就用默认值 */
  }
  if (theme === "system") {
    theme = window.matchMedia && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  root.setAttribute("data-theme", theme);

  if (cache && typeof cache === "object") {
    // 占位纯色：图片还没出来之前先显示它
    if (typeof cache.color === "string") root.style.setProperty("--bg-base", cache.color);
    // 渐变/纯色背景可以立刻画出来；图片背景要等加载，先只显示占位色
    if (typeof cache.css === "string" && cache.css) {
      root.style.setProperty("--bg-instant", cache.css);
      root.setAttribute("data-bginstant", "");
    }
    if (cache.tone === "light" || cache.tone === "dark") root.setAttribute("data-bgtone", cache.tone);
    if (typeof cache.blur === "number") root.style.setProperty("--blur", cache.blur + "px");
    if (typeof cache.dim === "number") root.style.setProperty("--dim", String(cache.dim / 100));
  }
})();
