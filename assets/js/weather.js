// 天气：问候语后面的一句，如"布里斯班 28° 多云"。按你所在的位置显示，不用自己设置城市。
//
// 位置：用浏览器的定位（第一次会问你允不允许）。
//   - 允许了：每次更新天气前顺便看一下位置，换了地方（超过约 3 公里）天气和地名跟着变；
//   - 浏览器设成"每次都问"的：最多 12 小时问一次，中间用上次定到的位置；
//   - 不允许、或者定位不了：显示默认城市（config/site.js 的 WEATHER_PLACE）。
// 地名：用 OpenStreetMap 的 Nominatim 把经纬度换成城市名，一律转成简体（只在换了地方时查一次，存在本机）。
// 天气：Open-Meteo（免费，不用 API Key）。
// 都由浏览器直接去取，不经过本站后台（Open-Meteo 按来访地址限次数，Cloudflare 后台的出口地址很多网站共用，代取容易被限流）；
// 发出去的只有大致位置（经纬度两位小数，约 1 公里），不带 Cookie。
// 存在本机的：sp:where（上次定到的位置和地名）、sp:weather（上次的天气）。
// 定位和查地名的代码在 weather-where.js：打开页面先按存着的显示，那部分稍后才加载（首屏少下载一些）。
// 页面在前台时每 30 分钟更新一次，在后台时不取；取不到就安静地不显示（3 小时以内存着的照常显示）。
import { store, readJSON, writeJSON, normalizePlace } from "./store.js";
import { WEATHER_PLACE } from "../../config/site.js";

const CACHE_KEY = "sp:weather";
export const WHERE_KEY = "sp:where";
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

/** 显示出来的那一句："布里斯班 28° 多云"（还不知道地名时只有"28° 多云"） */
export function weatherLine(place, weather) {
  return [place.name, `${Math.round(weather.temp)}°`, describeWeather(weather.code)].filter(Boolean).join(" ");
}

/** 位置的标记：经纬度变了，存着的天气就不算数 */
export const placeKey = (place) => `${place.lat.toFixed(2)},${place.lon.toFixed(2)}`;
const isCoord = (v, max) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= max;

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

/** 去取数据。referrer：要不要告诉对方是哪个网站在用（Nominatim 要求注明） */
export async function getJson(url, referrer = "no-referrer") {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  let res;
  try {
    res = await fetch(url, { signal: ctrl.signal, credentials: "omit", referrerPolicy: referrer });
  } catch (err) {
    throw new Error(err?.name === "AbortError" ? "对方太久没有回应" : "连不上，检查一下网络");
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`对方暂时不可用（${res.status}）`);
  try {
    return await res.json();
  } catch {
    throw new Error("对方返回的内容看不懂");
  }
}

/** 上次定到的位置 { name, lat, lon, at }；没有或格式不对返回 null */
export function savedWhere() {
  const w = readJSON(WHERE_KEY);
  if (!w || typeof w !== "object" || !isCoord(w.lat, 90) || !isCoord(w.lon, 180) || typeof w.at !== "number") return null;
  return { name: typeof w.name === "string" ? w.name.slice(0, 40) : "", lat: w.lat, lon: w.lon, at: w.at };
}

const defaultPlace = normalizePlace(WEATHER_PLACE);

/** 存着的天气：是这个位置的、不算太旧，才拿来显示 */
function savedFor(place) {
  const saved = readJSON(CACHE_KEY);
  if (!saved || typeof saved !== "object" || saved.key !== placeKey(place)) return null;
  const age = Date.now() - saved.at;
  if (!(age >= 0 && age < KEEP)) return null;
  const weather = checkWeather(saved.temp, saved.code);
  return weather && { ...weather, age };
}

let relocateNow = null;
let whereModule = null;
/** 定位和查地名的代码（weather-where.js），用到时才加载 */
const whereCode = () => (whereModule ||= import("./weather-where.js").catch((err) => ((whereModule = null), Promise.reject(err))));

/** 设置里的"重新定位"：马上问一次位置并更新天气。返回 locate() 的结果；天气关着时返回 "off" */
export function relocate() {
  return relocateNow ? relocateNow() : Promise.resolve("off");
}

/** 设置里显示用：现在按哪里显示天气 { where: 定到的位置或 null, fallback: 默认城市或 null } */
export function weatherPlace() {
  return { where: savedWhere(), fallback: defaultPlace };
}

/**
 * 开始显示天气。onText(这一句) 在要显示的内容变化时调用，不显示时传 ""。
 * 时钟关了、天气关了时都不显示，也不去取、不定位。
 */
export function initWeather(onText) {
  let timer = 0;
  let busy = false;
  let shown = null;
  let last = null;

  const enabled = () => {
    const w = store.get().widgets;
    return w.clock && w.weather;
  };
  /** 按哪里显示：上次定到的位置，没有就用默认城市 */
  const placeNow = () => (enabled() ? savedWhere() || defaultPlace : null);

  function show() {
    const place = placeNow();
    const weather = place && savedFor(place);
    const text = weather ? weatherLine(place, weather) : "";
    if (text !== shown) onText((shown = text));
  }

  function later(ms) {
    clearTimeout(timer);
    timer = setTimeout(refresh, ms);
  }

  /** 按现在的位置取天气（存着的还新就不取）。返回 false 表示该取却没取到 */
  async function fetchWeather() {
    const place = placeNow();
    if (!place) return true;
    const saved = savedFor(place);
    if (saved && saved.age < REFRESH) return true;
    try {
      const weather = parseForecast(await getJson(forecastUrl(place)));
      if (weather) {
        writeJSON(CACHE_KEY, { key: placeKey(place), at: Date.now(), temp: weather.temp, code: weather.code });
        return true;
      }
    } catch {
      /* 取不到：按存着的显示（太旧就不显示），过一会儿再试 */
    }
    return false;
  }

  async function refresh() {
    clearTimeout(timer);
    if (!enabled() || document.hidden || busy) return; // 页面在后台时不取，回到前台再说
    busy = true;
    let ok = true;
    const { locate, permissionState } = await whereCode();
    if ((await permissionState()) === "granted") {
      // 已经允许定位：先悄悄看一下位置，再按位置取天气
      await locate();
      ok = await fetchWeather();
      show();
    } else {
      // 可能要问：先按已知的位置（上次定到的或默认城市）显示，问到了再按新位置取
      ok = await fetchWeather();
      show();
      const result = await locate();
      if (result === "moved" || result === "denied") {
        ok = await fetchWeather();
        show();
      }
    }
    busy = false;
    if (enabled()) later(ok ? REFRESH : RETRY);
  }

  relocateNow = async () => {
    if (!enabled()) return "off";
    const { locate } = await whereCode();
    const result = await locate(true);
    if (result === "moved" || result === "denied" || result === "same") {
      await fetchWeather();
      show();
    }
    return result;
  };

  // 设置变了（开关）：先按存着的显示，需要的话马上去取
  let started = false;
  function sync() {
    const on = enabled() ? "on" : "";
    if (on === last) return;
    last = on;
    show();
    if (started) refresh();
  }

  sync(); // 打开页面：马上按存着的显示
  store.subscribe(sync);
  // 第一次定位、更新等页面画完、浏览器空闲时再做：不拖慢打开速度，iPhone 上"允许使用位置吗"也不会在页面出来之前就弹出
  const start = () =>
    (window.requestIdleCallback || ((fn) => setTimeout(fn, 800)))(
      () => {
        started = true;
        refresh();
      },
      { timeout: 3000 }
    );
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !started) return;
    show();
    refresh();
  });
  window.addEventListener("online", () => started && refresh());
}
