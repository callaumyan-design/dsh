// 设置的读取、保存和校验。所有设置都只存在浏览器本地（localStorage）。
import { BACKGROUND_PRESETS, DEFAULT_BACKGROUND } from "../../config/site.js";
import { normalizeId, DEFAULT_WATCHLIST, MAX_IDS } from "./market/ids.js";

const SETTINGS_KEY = "sp:settings";

// ---------- 本地存储的安全封装（隐私模式下可能读写失败，失败就退回内存） ----------
const memory = new Map();

export function readJSON(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? (memory.has(key) ? memory.get(key) : fallback) : JSON.parse(raw);
  } catch {
    return memory.has(key) ? memory.get(key) : fallback;
  }
}

export function writeJSON(key, value) {
  memory.set(key, value);
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key) {
  memory.delete(key);
  try {
    localStorage.removeItem(key);
  } catch {
    /* 忽略 */
  }
}

// ---------- 小工具 ----------
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const oneOf = (v, list, d) => (list.includes(v) ? v : d);
const bool = (v, d) => (typeof v === "boolean" ? v : d);
const num = (v, min, max, d) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d);
const str = (v, max, d = "") => (typeof v === "string" ? v.slice(0, max) : d);
const hex = (v, d) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : d);

/** 只允许 http / https 网址（挡掉 javascript: 之类的危险写法）；allowRelative 时也允许站内相对路径 */
export function safeUrl(value, { allowRelative = false } = {}) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text || text.length > 2000) return "";
  // 去掉空白和控制字符后再判断协议，防止 "java\nscript:" 这类绕过
  const compact = text.replace(/[\u0000- ]+/g, "");
  if (/^https?:\/\//i.test(compact)) {
    try {
      new URL(text);
      return text;
    } catch {
      return "";
    }
  }
  if (!allowRelative) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(compact) || compact.startsWith("//") || compact.startsWith("\\")) return "";
  return text;
}

/** 搜索引擎网址模板：必须是 http(s) 且包含 %s */
export function safeTemplate(value) {
  const url = safeUrl(value);
  return url && url.includes("%s") ? url : "";
}

// ---------- 默认设置 ----------
export function defaultSettings() {
  return {
    v: 1,
    theme: "system", // system | light | dark
    linkTarget: "auto", // auto（按每个入口自己的设置）| new | same
    search: {
      engine: "google", // 默认搜索引擎
      remember: true, // 记住上次用的引擎
      last: "", // 上次用的引擎
      history: true, // 记录本地搜索历史
      tabSwitch: true, // 在搜索框里按 Tab 切换引擎
      voiceLang: "zh-CN", // 语音输入的识别语言：zh-CN 普通话 | en-US 英语
      transparency: 50, // 搜索框透明度 %：0 = 完全不透明，100 = 完全透明
      custom: [], // 自定义引擎 [{id, name, url, bang}]
    },
    // 小组件：时钟（含日期和问候语）；天气跟在问候语后面，按定位显示（见 weather.js）
    widgets: { clock: true, weather: true },
    // 行情（首页搜索框下面）：关注列表只存在这台设备的浏览器里，会跟着"导出设置"一起导出
    market: {
      enabled: true, // 在首页显示；关掉后不显示、不加载、不联网
      colors: "red-up", // red-up 红涨绿跌 | green-up 绿涨红跌
      refresh: 5, // 卡片开着时多少分钟刷新一次：1 | 5 | 15
      list: DEFAULT_WATCHLIST.map((x) => ({ ...x })), // [{ id: "SH:600519", name: "贵州茅台" }]
    },
    // 文字：字体、字号、粗细，以及时钟单独的大小和粗细
    font: {
      family: "system", // system | serif | kai | round | mono | custom
      custom: "", // family 为 custom 时用的字体名（需要设备上装了这个字体）
      scale: 100, // 整体字号 %
      weight: 400, // 整体粗细 300~700
      clockScale: 100, // 时钟大小 %
      clockWeight: 600, // 时钟粗细 100~900
    },
    bg: {
      type: "preset", // preset | color | image | online
      preset: DEFAULT_BACKGROUND,
      color: { c1: "#1e3a8a", c2: "#7c3aed", gradient: true, angle: 135 },
      images: [], // [{id, kind: "upload" | "url", url?, color?, lum?}]  图片本体在 IndexedDB
      current: "", // 当前选中的图片 id
      random: false, // 每次打开随机换一张
      // 在线壁纸：source 是壁纸来源（见 background.js 里的 ONLINE_SOURCES），url 是自定义接口地址，every 是多久换一张
      online: { source: "picsum", url: "", every: "open" }, // every: open | hour | day | manual
      blur: 0, // 模糊 px
      dim: 25, // 暗度 %
    },
  };
}

/** 天气的默认城市（config/site.js）：名称、所在地区、经纬度（只保留两位小数，约 1 公里，够查天气用了）。格式不对返回 null */
export function normalizePlace(p) {
  if (!isObj(p)) return null;
  const coord = (v, max) => (typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= max ? Math.round(v * 100) / 100 : null);
  const name = str(p.name, 40).replace(/\s+/g, " ").trim();
  const lat = coord(p.lat, 90);
  const lon = coord(p.lon, 180);
  if (!name || lat === null || lon === null) return null;
  return { name, area: str(p.area, 80).replace(/\s+/g, " ").trim(), lat, lon };
}

/** 把任意来源（本地存储、导入的文件）的数据洗成一份合法的设置 */
export function normalizeSettings(raw) {
  const d = defaultSettings();
  if (!isObj(raw)) return d;
  const out = d;
  out.theme = oneOf(raw.theme, ["system", "light", "dark"], d.theme);
  out.linkTarget = oneOf(raw.linkTarget, ["auto", "new", "same"], d.linkTarget);

  const s = isObj(raw.search) ? raw.search : {};
  const custom = [];
  const seen = new Set();
  for (const item of Array.isArray(s.custom) ? s.custom.slice(0, 30) : []) {
    if (!isObj(item)) continue;
    const name = str(item.name, 30).trim();
    const url = safeTemplate(item.url);
    const id = /^c-[a-z0-9]{1,24}$/.test(item.id) ? item.id : "";
    if (!name || !url || !id || seen.has(id)) continue;
    seen.add(id);
    custom.push({ id, name, url, bang: str(item.bang, 12).trim().replace(/^!+/, "").replace(/\s+/g, "").toLowerCase() });
  }
  out.search = {
    engine: str(s.engine, 40, d.search.engine) || d.search.engine,
    remember: bool(s.remember, d.search.remember),
    last: str(s.last, 40),
    history: bool(s.history, d.search.history),
    tabSwitch: bool(s.tabSwitch, d.search.tabSwitch),
    voiceLang: oneOf(s.voiceLang, ["zh-CN", "en-US"], d.search.voiceLang),
    transparency: Math.round(num(s.transparency, 0, 100, d.search.transparency)),
    custom,
  };

  const w = isObj(raw.widgets) ? raw.widgets : {};
  out.widgets = {
    clock: bool(w.clock, d.widgets.clock),
    weather: bool(w.weather, d.widgets.weather),
  };

  const mk = isObj(raw.market) ? raw.market : {};
  const list = [];
  const listed = new Set();
  // 没有这一项（比如旧版导出的文件）就用示例；有但是空的，说明是自己删光的，保持为空
  for (const item of Array.isArray(mk.list) ? mk.list.slice(0, MAX_IDS * 2) : d.market.list) {
    const id = normalizeId(isObj(item) ? item.id : "");
    if (!id || listed.has(id) || list.length >= MAX_IDS) continue;
    listed.add(id);
    list.push({ id, name: str(item.name, 40).trim() });
  }
  out.market = {
    enabled: bool(mk.enabled, d.market.enabled),
    colors: oneOf(mk.colors, ["red-up", "green-up"], d.market.colors),
    refresh: oneOf(Number(mk.refresh), [1, 5, 15], d.market.refresh),
    list,
  };

  const f = isObj(raw.font) ? raw.font : {};
  const step100 = (v, min, max, dflt) => Math.round(num(v, min, max, dflt) / 100) * 100;
  out.font = {
    family: oneOf(f.family, ["system", "serif", "kai", "round", "mono", "custom"], d.font.family),
    // 字体名里去掉引号、分号、括号这类会破坏样式的字符
    custom: str(f.custom, 40).replace(/["';:{}()<>\\]/g, "").trim(),
    scale: Math.round(num(f.scale, 85, 130, d.font.scale)),
    weight: step100(f.weight, 300, 700, d.font.weight),
    clockScale: Math.round(num(f.clockScale, 60, 160, d.font.clockScale)),
    clockWeight: step100(f.clockWeight, 100, 900, d.font.clockWeight),
  };
  if (out.font.family === "custom" && !out.font.custom) out.font.family = "system";

  const b = isObj(raw.bg) ? raw.bg : {};
  const c = isObj(b.color) ? b.color : {};
  const images = [];
  const imageIds = new Set();
  for (const item of Array.isArray(b.images) ? b.images.slice(0, 60) : []) {
    if (!isObj(item) || !/^[a-z0-9-]{1,40}$/.test(item.id) || imageIds.has(item.id)) continue;
    if (item.kind === "url") {
      const url = safeUrl(item.url);
      if (!url) continue;
      images.push({ id: item.id, kind: "url", url });
    } else if (item.kind === "upload") {
      images.push({ id: item.id, kind: "upload", color: hex(item.color, "#1e293b"), lum: num(item.lum, 0, 1, 0.3) });
    } else continue;
    imageIds.add(item.id);
  }
  const o = isObj(b.online) ? b.online : {};
  const online = {
    source: oneOf(o.source, ["picsum", "bing-today", "bing", "custom"], d.bg.online.source),
    url: safeUrl(o.url),
    every: oneOf(o.every, ["open", "hour", "day", "manual"], d.bg.online.every),
  };
  if (online.source === "custom" && !online.url) online.source = "picsum"; // 选了自定义接口但没填地址
  out.bg = {
    type: oneOf(b.type, ["preset", "color", "image", "online"], d.bg.type),
    preset: BACKGROUND_PRESETS.some((p) => p.id === b.preset) ? b.preset : d.bg.preset,
    color: {
      c1: hex(c.c1, d.bg.color.c1),
      c2: hex(c.c2, d.bg.color.c2),
      gradient: bool(c.gradient, d.bg.color.gradient),
      angle: num(c.angle, 0, 360, d.bg.color.angle),
    },
    images,
    current: imageIds.has(b.current) ? b.current : images[0]?.id || "",
    random: bool(b.random, d.bg.random),
    online,
    blur: num(b.blur, 0, 30, d.bg.blur),
    dim: num(b.dim, 0, 80, d.bg.dim),
  };
  // 选了"图片"但一张图都没有时，退回预设背景
  if (out.bg.type === "image" && !images.length) out.bg.type = "preset";
  return out;
}

// ---------- 设置仓库 ----------
let settings = normalizeSettings(readJSON(SETTINGS_KEY));
const listeners = new Set();

function emit() {
  for (const fn of listeners) fn(settings);
}

export const store = {
  get: () => settings,

  /** 修改设置：传入一个函数，直接改草稿对象即可 */
  update(mutate) {
    const draft = structuredClone(settings);
    mutate(draft);
    settings = normalizeSettings(draft);
    writeJSON(SETTINGS_KEY, settings);
    emit();
  },

  /** 整体替换（导入、恢复默认时用） */
  replace(raw) {
    settings = normalizeSettings(raw);
    writeJSON(SETTINGS_KEY, settings);
    emit();
  },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

// 在别的标签页里改了设置，这边跟着更新
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === SETTINGS_KEY) {
      settings = normalizeSettings(readJSON(SETTINGS_KEY));
      emit();
    }
  });
}

/** 生成一个简短的随机 id */
export function uid(prefix = "") {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return prefix + Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 10);
}
