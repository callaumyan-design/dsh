// 首屏防闪烁：在页面开始绘制之前，先把主题（深/浅色）和背景占位定下来。
// 这个文件故意写得很小、同步执行，放在 <head> 里最先加载。
(function () {
  var root = document.documentElement;
  var theme = "system";
  var cache = null;
  var type = null;
  try {
    var saved = JSON.parse(localStorage.getItem("sp:settings") || "null");
    if (saved && (saved.theme === "light" || saved.theme === "dark")) theme = saved.theme;
    cache = JSON.parse(localStorage.getItem("sp:bg-cache") || "null");
    type = JSON.parse(localStorage.getItem("sp:type-cache") || "null");
  } catch (e) {
    /* 读不到本地存储就用默认值 */
  }
  if (theme === "system") {
    theme = window.matchMedia && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  root.setAttribute("data-theme", theme);

  // 文字设置（字体、字号、粗细）：提前套用，避免先闪一下默认样式
  if (type && typeof type === "object") {
    ["--font", "--fs", "--fw", "--clock-scale", "--clock-weight"].forEach(function (name) {
      if (typeof type[name] === "string") root.style.setProperty(name, type[name]);
    });
  }

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
    // 搜索框的透明度，以及里面用白字还是深字
    if (typeof cache.searchAlpha === "number") root.style.setProperty("--search-alpha", String(cache.searchAlpha));
    if (cache.searchTone === "light" || cache.searchTone === "dark") root.setAttribute("data-searchtone", cache.searchTone);
    // 壁纸有出处要显示：先在页面最底下留出那一行的位置
    if (cache.credit === true) root.setAttribute("data-credit", "");
  }
})();
