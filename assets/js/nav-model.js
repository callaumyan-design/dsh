// 导航数据的整理与合并：配置文件里的默认入口 + 浏览器本地的改动（排序、隐藏、自定义入口）。
// 这个文件不碰页面，方便单独测试。
import { safeUrl } from "./store.js";

export const DEFAULT_GROUP = "我的入口";

const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** 把一条入口洗成合法格式；不合法（没名字、网址不安全）返回 null */
export function normalizeEntry(raw, { custom = false } = {}) {
  if (!raw || typeof raw !== "object") return null;
  const name = text(raw.name, 40);
  const url = safeUrl(raw.url, { allowRelative: true });
  if (!name || !url) return null;
  let id;
  if (custom) {
    if (typeof raw.id !== "string" || !/^c:[a-z0-9]{1,24}$/.test(raw.id)) return null;
    id = raw.id;
  } else {
    // 默认入口的 id：没写就用网址，这样改名字、挪位置都不会丢失用户的排序和隐藏记录
    id = "d:" + (text(raw.id, 80) || url);
  }
  return {
    id,
    name,
    url,
    icon: text(raw.icon, 300),
    // 图标底色（可选），如 "#5b5bd6"；不写就用默认的淡蓝色
    color: typeof raw.color === "string" && /^#[0-9a-f]{6}$/i.test(raw.color.trim()) ? raw.color.trim().toLowerCase() : "",
    desc: text(raw.desc, 80),
    group: text(raw.group, 20) || DEFAULT_GROUP,
    newTab: raw.newTab !== false,
    custom,
  };
}

/** 本地改动的格式：{ order: [id...], hidden: [id...], custom: [入口...] } */
export function normalizeNavState(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const ids = (list) => (Array.isArray(list) ? [...new Set(list.filter((x) => typeof x === "string" && x.length <= 2100))].slice(0, 500) : []);
  const custom = [];
  const seen = new Set();
  for (const item of Array.isArray(src.custom) ? src.custom.slice(0, 200) : []) {
    const entry = normalizeEntry(item, { custom: true });
    if (entry && !seen.has(entry.id)) {
      seen.add(entry.id);
      custom.push(entry);
    }
  }
  return { order: ids(src.order), hidden: ids(src.hidden), custom };
}

/**
 * 合并默认入口和本地改动，按分组返回：[{ name, items: [入口...] }]
 * includeHidden 为 true 时（编辑模式）隐藏的入口也返回，并带上 hidden: true。
 */
export function buildGroups(defaults, state, { includeHidden = false } = {}) {
  const all = [];
  const seen = new Set();
  for (const raw of Array.isArray(defaults) ? defaults : []) {
    const entry = normalizeEntry(raw);
    if (entry && !seen.has(entry.id)) {
      seen.add(entry.id);
      all.push(entry);
    }
  }
  for (const entry of state.custom) {
    if (!seen.has(entry.id)) {
      seen.add(entry.id);
      all.push(entry);
    }
  }

  // 排序：用户拖动过的按拖动后的顺序；之后新加进配置文件的入口排在本组后面
  const rank = new Map(state.order.map((id, i) => [id, i]));
  const hidden = new Set(state.hidden);
  const groups = new Map(); // 分组顺序 = 在配置文件里第一次出现的顺序
  all.forEach((entry, index) => {
    if (!groups.has(entry.group)) groups.set(entry.group, []);
    const isHidden = hidden.has(entry.id);
    if (isHidden && !includeHidden) return;
    groups.get(entry.group).push({ ...entry, hidden: isHidden, _rank: rank.has(entry.id) ? rank.get(entry.id) : Infinity, _index: index });
  });

  const result = [];
  for (const [name, items] of groups) {
    if (!items.length) continue;
    items.sort((a, b) => (a._rank === b._rank ? a._index - b._index : a._rank - b._rank));
    result.push({ name, items: items.map(({ _rank, _index, ...entry }) => entry) });
  }
  return result;
}
