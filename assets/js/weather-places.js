// 设置 → 小组件里搜天气的城市：输入城市名，去 Open-Meteo 的城市查询找经纬度。
// 只有设置面板用到，打开设置时才加载（首屏不加载）。
import { normalizePlace } from "./store.js";
import { getJson, placeKey } from "./weather.js";

export const GEOCODING_API = "https://geocoding-api.open-meteo.com/v1/search";

/** 从城市搜索的回复里整理出候选城市（名称、所在地区、经纬度），最多 8 个 */
export function parsePlaces(data) {
  const list = data && Array.isArray(data.results) ? data.results : [];
  const out = [];
  const seen = new Set();
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    // 所在地区：省/州 · 国家（和城市名相同的不重复写，如"新加坡 · 新加坡"）
    const parts = [];
    for (const x of [r.admin1, r.country]) {
      if (typeof x === "string" && x.trim() && x !== r.name && !parts.includes(x)) parts.push(x.trim());
    }
    const place = normalizePlace({ name: r.name, area: parts.join(" · "), lat: r.latitude, lon: r.longitude });
    if (!place) continue;
    const id = `${place.name}|${placeKey(place)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(place);
    if (out.length >= 8) break;
  }
  return out;
}

/** 设置里搜城市：中文、英文都行。返回候选城市列表 */
export async function searchPlaces(query) {
  const q = String(query || "").trim().slice(0, 60);
  if (!q) return [];
  return parsePlaces(await getJson(`${GEOCODING_API}?name=${encodeURIComponent(q)}&count=10&language=zh&format=json`));
}
