// 小组件：时间、日期和问候语，问候语后面跟一句天气（都默认开启，可在设置里关掉）
import { store } from "./store.js";
import { $, h } from "./ui.js";
import { initWeather } from "./weather.js";

function greeting(hour) {
  if (hour < 5) return "夜深了，早点休息";
  if (hour < 9) return "早上好";
  if (hour < 12) return "上午好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  if (hour < 23) return "晚上好";
  return "夜深了，早点休息";
}

export function initClock() {
  const box = $("#clock");
  const timeEl = $("#clock-time");
  const subEl = $("#clock-sub");
  const dateFormat = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" });
  let timer = 0;
  let weather = ""; // 天气那一句，如"布里斯班 28° 多云"（见 weather.js）；没有就是空

  // 天气在这一行里放不下、被挤到下一行时：去掉前面的小圆点，整句单独占一行（不然行尾会挂着一个孤零零的"·"）
  function fit() {
    subEl.classList.remove("wrap");
    const greet = subEl.querySelector(".clock-greet");
    const wx = subEl.querySelector(".clock-weather");
    if (box.hidden || !greet || !wx) return;
    const lines = greet.getClientRects();
    const end = lines[lines.length - 1];
    if (end && wx.getBoundingClientRect().top - end.top > end.height / 2) subEl.classList.add("wrap");
  }

  function tick() {
    clearTimeout(timer);
    if (!store.get().widgets.clock) {
      box.hidden = true;
      return;
    }
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    timeEl.textContent = `${hh}:${mm}`;
    timeEl.dateTime = now.toISOString();
    subEl.replaceChildren(
      h("span", { class: "clock-greet" }, `${dateFormat.format(now)} · ${greeting(now.getHours())}`),
      ...(weather ? [h("span", { class: "clock-sep" }, " · "), h("span", { class: "clock-weather" }, weather)] : [])
    );
    box.hidden = false;
    fit();
    // 对齐到下一分钟整再刷新
    timer = setTimeout(tick, 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50);
  }

  tick();
  store.subscribe(tick);
  // 电脑休眠或标签页放到后台再回来时，立刻校准
  document.addEventListener("visibilitychange", () => !document.hidden && tick());
  // 窗口宽度变了、字体加载完了：重新看看天气放不放得下
  let frame = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(fit);
  });
  document.fonts?.ready.then(fit);

  initWeather((text) => {
    weather = text;
    tick();
  });
}
