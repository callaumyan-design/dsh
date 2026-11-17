// 天气：问候语后面的一句，如"布里斯班 28° 多云"。数据来自 Open-Meteo（open-meteo.com，免费，不用 API Key）。
//
// 由浏览器直接去 Open-Meteo 取，不经过本站后台：
//   - Open-Meteo 按来访的网络地址限制次数，而 Cloudflare 后台的出口地址是很多网站共用的，代取容易被对方限流；
//   - 发过去的只有设置里选的城市的经纬度（两位小数，是城市的位置，不是你的位置），不带别的信息，也不带来源网址。
// 取到的结果存在本机（sp:weather）：下次打开先显示存着的，再去更新。
// 页面在前台时每 30 分钟更新一次，在后台时不取；取不到就安静地不显示（3 小时以内存着的照常显示）。
// 设置里搜城市的部分在 weather-places.js（打开设置时才加载）。
import { store, readJSON, writeJSON } from "./store.js";

const CACHE_KEY = "sp:weather";
const REFRESH = 30 * 60 * 1000; // 多久更新一次
const RETRY = 5 * 60 * 1000; // 没取到时，过多久再试
const KEEP = 3 * 3600 * 1000; // 取不到新的时，存着的最多再显示多久
const TIMEOUT = 8000; // 等对方回应最多多久

export const FORECAST_API = "https://api.open-meteo.com/v1/forecast";

// 世界气象组织（WMO）的天气代码 → 中文。没列出来的代码只显示温度
const WEATHER_TEXT = {
  0: "晴",
  1: "晴间多云",
  2: "多云",
  3: "阴",
  45: "雾",
  48: "雾",
  51: "毛毛雨",
  53: "毛毛雨",
  55: "毛毛雨",
  56: "冻毛毛雨",
  57: "冻毛毛雨",
  61: "小雨",
  63: "中雨",
  65: "大雨",
  66: "冻雨",
  67: "冻雨",
  71: "小雪",
  73: "中雪",
  75: "大雪",
  77: "米雪",
  80: "小阵雨",
  81: "阵雨",
  82: "强阵雨",
  85: "阵雪",
  86: "强阵雪",
  95: "雷阵雨",
  96: "雷阵雨伴冰雹",
  99: "雷阵雨伴冰雹",
};

export const describeWeather = (code) => WEATHER_TEXT[code] || "";

/** 显示出来的那一句："布里斯班 28° 多云" */
export function weatherLine(place, weather) {
  return [place.name, `${Math.round(weather.temp)}°`, describeWeather(weather.code)].filter(Boolean).join(" ");
}

/** 城市的标记：经纬度变了，存着的天气就不算数 */
export const placeKey = (place) => `${place.lat.toFixed(2)},${place.lon.toFixed(2)}`;

export function forecastUrl(place) {
  return `${FORECAST_API}?latitude=${place.lat.toFixed(2)}&longitude=${place.lon.toFixed(2)}&current=temperature_2m,weather_code`;
}

/** 核对温度和天气代码：温度要是个合理的数，代码不认识就当作没有。不对返回 null */
function checkWeather(temp, code) {
  if (typeof temp !== "number" || !Number.isFinite(temp) || temp < -90 || temp > 60) return null;
  return { temp, code: Number.isInteger(code) ? code : -1 };
}

/** 从 Open-Meteo 的回复里取出现在的温度和天气代码；格式不对返回 null */
export function parseForecast(data) {
  const now = data && typeof data === "object" ? data.current : null;
  if (!now || typeof now !== "object") return null;
  return checkWeather(now.temperature_2m, now.weather_code);
}

/** 去 Open-Meteo 取数据。出错时给一句看得懂的说明 */
export async function getJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  let res;
  try {
    res = await fetch(url, { signal: ctrl.signal, credentials: "omit", referrerPolicy: "no-referrer" });
  } catch (err) {
    throw new Error(err?.name === "AbortError" ? "天气服务太久没有回应" : "连不上天气服务，检查一下网络");
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`天气服务暂时不可用（${res.status}）`);
  try {
    return await res.json();
  } catch {
    throw new Error("天气服务返回的内容看不懂");
  }
}

/** 存着的天气：是这个城市的、不算太旧，才拿来显示 */
function savedFor(place) {
  const saved = readJSON(CACHE_KEY);
  if (!saved || typeof saved !== "object" || saved.key !== placeKey(place)) return null;
  const age = Date.now() - saved.at;
  if (!(age >= 0 && age < KEEP)) return null;
  const weather = checkWeather(saved.temp, saved.code);
  return weather && { ...weather, age };
}

/**
 * 开始显示天气。onText(这一句) 在要显示的内容变化时调用，不显示时传 ""。
 * 时钟关了、天气关了、或者没有城市时都不显示，也不去取。
 */
export function initWeather(onText) {
  let timer = 0;
  let busy = false;
  let shown = null;
  let last = null;

  const placeNow = () => {
    const w = store.get().widgets;
    return w.clock && w.weather && w.place ? w.place : null;
  };

  function show() {
    const place = placeNow();
    const weather = place && savedFor(place);
    const text = weather ? weatherLine(place, weather) : "";
    if (text !== shown) onText((shown = text));
  }

  function later(ms) {
    clearTimeout(timer);
    timer = setTimeout(update, ms);
  }

  async function update() {
    clearTimeout(timer);
    const place = placeNow();
    if (!place || document.hidden || busy) return; // 页面在后台时不取，回到前台再说
    const saved = savedFor(place);
    if (saved && saved.age < REFRESH) return later(REFRESH - saved.age);
    const key = placeKey(place);
    busy = true;
    let ok = false;
    try {
      const weather = parseForecast(await getJson(forecastUrl(place)));
      if (weather) {
        writeJSON(CACHE_KEY, { key, at: Date.now(), temp: weather.temp, code: weather.code });
        ok = true;
      }
    } catch {
      /* 取不到：按存着的显示（太旧就不显示），过一会儿再试 */
    }
    busy = false;
    show();
    const next = placeNow();
    if (!next) return;
    if (placeKey(next) !== key) return update(); // 取的时候换了城市：马上按新城市再取
    later(ok ? REFRESH : RETRY);
  }

  // 设置变了（开关、换城市）：先按存着的显示，需要的话马上去取
  function sync() {
    const place = placeNow();
    const sig = place ? `${place.name}|${placeKey(place)}` : "";
    if (sig === last) return;
    last = sig;
    show();
    update();
  }

  sync();
  store.subscribe(sync);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    show();
    update();
  });
  window.addEventListener("online", () => update());
}
