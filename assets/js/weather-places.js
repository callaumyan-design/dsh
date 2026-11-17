// 设置 → 小组件里搜天气的城市：输入城市名，去 Open-Meteo 的城市查询找经纬度。
// 只在设置里点"查找"时才加载（首屏和设置面板本身都不加载）。
//
// Open-Meteo 的中文地名繁简混用：有的城市只有繁体名（東京、溫哥華），有的要带"市"才搜得到（紐約市、台北市）。
// 它对两个字的名字只认完全一样的。所以：
//   - 搜中文时，简体、繁体、各加一个"市"，一共搜四次，结果合在一起，人口多的排前面；
//   - 还是有少数城市的中文名它没有（如首尔），这时用英文名能找到，设置里会提示；
//   - 搜到的地名、地区一律转成简体再显示和保存（繁简对照见 zh-hans.js）。
import { normalizePlace } from "./store.js";
import { getJson } from "./weather.js";
import { toSimplified, toTraditional } from "./zh-hans.js";

export const GEOCODING_API = "https://geocoding-api.open-meteo.com/v1/search";

const HAN = /[\u3400-\u9fff]/; // 含汉字
const base = (name) => name.replace(/市$/, "");

/** 从城市搜索的回复里整理出候选城市（名称、所在地区、经纬度，都转成简体），最多 8 个 */
export function parsePlaces(data) {
  const list = data && Array.isArray(data.results) ? data.results : [];
  const out = [];
  for (const r of list) {
    if (!r || typeof r !== "object" || typeof r.name !== "string") continue;
    if (typeof r.feature_code === "string" && r.feature_code.startsWith("AIR")) continue; // 机场、直升机场：和城市重复，不列
    const name = toSimplified(r.name).trim();
    // 所在地区：省/州 · 国家（和城市名相同的不重复写，如"新加坡 · 新加坡"、"北京 · 北京市"）
    const parts = [];
    for (const x of [r.admin1, r.country]) {
      const part = typeof x === "string" ? toSimplified(x).trim() : "";
      if (part && base(part) !== base(name) && !parts.includes(part)) parts.push(part);
    }
    const place = normalizePlace({ name, area: parts.join(" · "), lat: r.latitude, lon: r.longitude });
    if (!place) continue;
    // 同名（"北京"和"北京市"也算同名）、离得很近（50 公里左右以内）的算同一个地方，只留第一个
    // （比如"香港"会同时返回"香港地区"和"香港市区"）
    const same = (p) => base(p.name) === base(place.name) && Math.abs(p.lat - place.lat) < 0.5 && Math.abs(p.lon - place.lon) < 0.5;
    if (out.some(same)) continue;
    out.push(place);
    if (out.length >= 8) break;
  }
  return out;
}

/** 几次搜索的结果合在一起：人口多的排前面（人口一样的保持原来的顺序） */
export function mergeReplies(replies) {
  if (replies.length === 1) return replies[0];
  const all = replies.flatMap((data) => (data && Array.isArray(data.results) ? data.results : []));
  const people = (r) => (r && typeof r.population === "number" && Number.isFinite(r.population) ? r.population : 0);
  return { results: all.map((r, i) => [r, i]).sort((a, b) => people(b[0]) - people(a[0]) || a[1] - b[1]).map(([r]) => r) };
}

/** 设置里搜城市：简体中文、英文都行。返回候选城市列表 */
export async function searchPlaces(query) {
  const q = toSimplified(String(query || "").trim().slice(0, 60));
  if (!q) return [];
  const names = [q];
  if (HAN.test(q)) {
    const t = toTraditional(q);
    for (const name of [t, ...(base(q) === q ? [q + "市", t + "市"] : [base(q), base(t)])]) if (name && !names.includes(name)) names.push(name);
  }
  const replies = await Promise.allSettled(names.map((name) => getJson(`${GEOCODING_API}?name=${encodeURIComponent(name)}&count=10&language=zh&format=json`)));
  const ok = replies.filter((r) => r.status === "fulfilled").map((r) => r.value);
  if (!ok.length) throw replies[0].reason; // 都没搜成：报第一个的原因
  return parsePlaces(mergeReplies(ok));
}
