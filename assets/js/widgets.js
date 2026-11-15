// 小组件：时间、日期和问候语（默认开启，可在设置里关掉）
import { store } from "./store.js";
import { $ } from "./ui.js";

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
    subEl.textContent = `${dateFormat.format(now)} · ${greeting(now.getHours())}`;
    box.hidden = false;
    // 对齐到下一分钟整再刷新
    timer = setTimeout(tick, 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50);
  }

  tick();
  store.subscribe(tick);
  // 电脑休眠或标签页放到后台再回来时，立刻校准
  document.addEventListener("visibilitychange", () => !document.hidden && tick());
}
