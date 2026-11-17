// 天气的定位和查地名：浏览器定位 → 经纬度；OpenStreetMap 的 Nominatim → 城市名（转成简体）。
// 由 weather.js 在更新天气时加载（打开页面先按存着的显示，这部分稍后才下载）。规则见 weather.js 开头。
import { writeJSON, removeKey } from "./store.js";
import { getJson, savedWhere, WHERE_KEY } from "./weather.js";

export const REVERSE_API = "https://nominatim.openstreetmap.org/reverse";
const ASK_EVERY = 12 * 3600 * 1000; // 浏览器每次都要问的：最多多久问一次
const ASK_WAIT = 60 * 1000; // 问了以后最多等多久（没人回答就先不管）
const MOVED = 0.03; // 经纬度变化超过这么多（约 3 公里）才算换了地方
const round2 = (v) => Math.round(v * 100) / 100;

export function reverseUrl(lat, lon) {
  return `${REVERSE_API}?format=jsonv2&lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}&zoom=10&addressdetails=1&accept-language=zh-CN,zh,en`;
}

// 直辖市和东京：OpenStreetMap 在这些地方给的"城市"是区（东城区、新宿区），换成城市名
const WHOLE_CITY = { "CN-BJ": "北京", "CN-SH": "上海", "CN-TJ": "天津", "CN-CQ": "重庆", "JP-13": "东京" };

/**
 * 从 Nominatim 的回复里挑出城市名（还没转简体）；挑不出返回 ""。
 * 优先用"城市"那一级，没有再往小（镇、村）、往大（县、省）找。
 * 一个字段里有好几种写法时（"纽约;紐約"、"东京都/東京都"）用第一种。
 */
export function pickCityName(data) {
  const a = data && typeof data === "object" && data.address && typeof data.address === "object" ? data.address : null;
  if (!a) return "";
  if (WHOLE_CITY[a["ISO3166-2-lvl4"]]) return WHOLE_CITY[a["ISO3166-2-lvl4"]];
  const raw = [a.city, a.town, a.village, a.municipality, a.county, a.province, a.state, data.name].find((v) => typeof v === "string" && v.trim());
  return raw ? raw.split(/[;/]/)[0].trim().slice(0, 40) : "";
}

/** 转好简体以后再收拾一下："上海市""台北市" → "上海""台北" */
export const tidyName = (name) => name.replace(/^([\u3400-\u9fff]{2,})市$/, "$1");

/** 经纬度 → 城市名（简体） */
async function placeName(lat, lon) {
  // Nominatim 的使用规定要求注明来源网站：这里只带网站地址（https://callaum.com/），不带具体页面
  const raw = pickCityName(await getJson(reverseUrl(lat, lon), "strict-origin"));
  if (!raw) return "";
  const { toSimplified } = await import("./zh-hans.js"); // 繁简对照表，用到才加载
  return tidyName(toSimplified(raw));
}

export async function permissionState() {
  try {
    return (await navigator.permissions.query({ name: "geolocation" })).state; // granted / prompt / denied
  } catch {
    return "unknown"; // 不支持查询的浏览器：当作"每次都问"
  }
}

/** fresh：要现定的位置（"重新定位"时）；平时 10 分钟内定过的可以直接用，省电 */
function getPosition(fresh) {
  return new Promise((resolve, reject) => {
    // 问了没人回答：一分钟后先不等了（之后再回答也不影响下一次）
    const wait = setTimeout(() => reject({ code: 3 }), ASK_WAIT);
    navigator.geolocation.getCurrentPosition(
      (pos) => (clearTimeout(wait), resolve(pos)),
      (err) => (clearTimeout(wait), reject(err)),
      { enableHighAccuracy: false, maximumAge: fresh ? 0 : 10 * 60 * 1000, timeout: 20000 }
    );
  });
}

/**
 * 看一下现在在哪，结果存进 sp:where。返回：
 *   "moved"  换了地方（或第一次定到）     "same"   还在原来的地方
 *   "denied" 不允许定位（存着的位置删掉，回到默认城市）
 *   "failed" 这次没定到（信号不好、超时）   "skipped" 这次不问（浏览器每次都要问，而 12 小时内问过）
 *   "unsupported" 浏览器不支持定位
 * force：在设置里点了"重新定位"，不管多久前问过都问
 */
export async function locate(force = false) {
  if (!("geolocation" in navigator)) return "unsupported";
  const state = await permissionState();
  const where = savedWhere();
  if (state === "denied") return forget(where);
  if (state !== "granted" && !force && where && Date.now() - where.at < ASK_EVERY) return "skipped";
  let pos;
  try {
    pos = await getPosition(force);
  } catch (err) {
    return err && err.code === 1 ? forget(where) : "failed"; // 1：不允许
  }
  const lat = round2(pos.coords.latitude);
  const lon = round2(pos.coords.longitude);
  const near = where && Math.abs(where.lat - lat) < MOVED && Math.abs(where.lon - lon) < MOVED;
  if (near && where.name) {
    writeJSON(WHERE_KEY, { ...where, at: Date.now() });
    return "same";
  }
  // 换了地方（或者上次没查到地名）：查地名。查不到先只显示温度，下次再查
  let name = near ? where.name : "";
  try {
    name = (await placeName(lat, lon)) || name;
  } catch {
    /* 下次再查 */
  }
  writeJSON(WHERE_KEY, near ? { ...where, name, at: Date.now() } : { name, lat, lon, at: Date.now() });
  return "moved";
}

function forget(where) {
  if (where) removeKey(WHERE_KEY);
  return "denied";
}
