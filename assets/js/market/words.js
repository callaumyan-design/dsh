// 搜索时在本地就能认出来的东西：代码、汇率、常用指数的叫法。页面（添加关注）和后台（/api/quotes/search）共用。
// 首屏用不到，所以单独放一个文件，打开行情卡片时才加载。
// 这里只能引用 ./ids.js（发布时会把引用改成后台包里的文件名），不能碰页面。
import { normalizeId, inferAShare, isIndex } from "./ids.js";

// 名称搜索（"茅台""腾讯""英伟达"）由后台去腾讯 / 新浪的搜索接口查；这里只管看一眼就知道是什么的输入，
// 这样就算搜索接口出了问题，直接输代码、输"澳元"也照样能加。

/** 各币种的叫法（汇率搜索用） */
const FX_WORDS = {
  CNH: ["离岸人民币", "离岸", "CNH"],
  CNY: ["在岸人民币", "人民币", "在岸", "CNY", "RMB"],
  USD: ["美元", "美金", "USD"],
  AUD: ["澳元", "澳币", "澳大利亚元", "AUD"],
  HKD: ["港币", "港元", "HKD"],
  EUR: ["欧元", "EUR"],
  GBP: ["英镑", "GBP"],
  JPY: ["日元", "日币", "JPY"],
  NZD: ["新西兰元", "纽元", "纽币", "NZD"],
  CAD: ["加元", "加币", "CAD"],
  SGD: ["新加坡元", "新元", "SGD"],
  CHF: ["瑞士法郎", "瑞郎", "CHF"],
  KRW: ["韩元", "KRW"],
  TWD: ["新台币", "台币", "TWD"],
};

/**
 * 从输入里认出汇率。例："澳元" → [FX:AUDCNY, FX:AUDCNH]；"美元 离岸" → [FX:USDCNH, FX:USDCNY]；
 * "澳元美元" → [FX:AUDUSD]；"AUD/CNY"、"audcny" → [FX:AUDCNY]
 */
export function fxCandidates(input) {
  const raw = String(input || "").trim();
  if (!raw || raw.length > 20) return [];
  const direct = /^([A-Za-z]{3})\s*\/?\s*([A-Za-z]{3})$/.exec(raw);
  if (direct) {
    const id = normalizeId(`FX:${direct[1]}${direct[2]}`);
    return id ? [id] : [];
  }
  // 按出现的先后找币种（长的叫法先认，免得"离岸人民币"被认成"人民币"）
  const text = raw.toUpperCase();
  const found = [];
  const words = Object.entries(FX_WORDS).flatMap(([code, list]) => list.map((w) => [w.toUpperCase(), code])).sort((a, b) => b[0].length - a[0].length);
  let rest = text;
  const hits = [];
  for (const [word, code] of words) {
    let at = rest.indexOf(word);
    while (at >= 0) {
      hits.push([at, code]);
      rest = rest.slice(0, at) + "\u0000".repeat(word.length) + rest.slice(at + word.length);
      at = rest.indexOf(word);
    }
  }
  for (const [, code] of hits.sort((a, b) => a[0] - b[0])) if (!found.includes(code)) found.push(code);
  const offshore = found.includes("CNH");
  const foreign = found.filter((c) => c !== "CNY" && c !== "CNH");
  const yuan = offshore ? ["CNH", "CNY"] : ["CNY", "CNH"];
  let pairs = [];
  if (foreign.length >= 2) pairs = [`${foreign[0]}${foreign[1]}`];
  else if (foreign.length === 1) pairs = yuan.map((y) => `${foreign[0]}${y}`); // 只说了一种外币：给它兑人民币（在岸、离岸）
  else if (found.length) pairs = yuan.map((y) => `USD${y}`); // 只说了"人民币""离岸"：给美元兑人民币
  return pairs.map((p) => normalizeId(`FX:${p}`)).filter(Boolean);
}

const HK_INDEXES = ["HSI", "HSCEI", "HSTECH"];

/** 常用指数的叫法：搜这些词时，指数本身排在最前面（搜索接口常常只给出一堆跟踪它的基金） */
const INDEX_NAMES = [
  ["SH:000001", ["上证指数", "上证综指", "沪指", "上证"]],
  ["SZ:399001", ["深证成指", "深成指", "深证"]],
  ["SZ:399006", ["创业板指", "创业板"]],
  ["SH:000300", ["沪深300"]],
  ["SH:000688", ["科创50", "科创板"]],
  ["BJ:899050", ["北证50", "北证"]],
  ["HK:HSI", ["恒生指数", "恒指"]],
  ["HK:HSTECH", ["恒生科技指数", "恒生科技", "恒科"]],
  ["HK:HSCEI", ["国企指数", "恒生中国企业指数", "H股指数"]],
  ["US:.IXIC", ["纳斯达克综合指数", "纳斯达克", "纳指", "NASDAQ"]],
  ["US:.DJI", ["道琼斯工业指数", "道琼斯", "道指", "DOW"]],
  ["US:.INX", ["标普500指数", "标普500", "标普", "S&P500", "SP500"]],
];

/**
 * 输入看起来像代码时，直接给出可能的统一代码（不联网）。例：
 *   "600519" → [SH:600519]；"000001" → [SZ:000001, SH:000001]；"700" → [HK:00700]；
 *   "nvda" → [US:NVDA]；".ixic" → [US:.IXIC]；"HSI" → [HK:HSI, US:HSI]；"澳元" → [FX:AUDCNY, FX:AUDCNH]
 */
export function localCandidates(input) {
  const text = String(input || "").trim().toUpperCase().replace(/\s+/g, "");
  const out = [];
  const add = (id) => id && !out.includes(id) && out.push(id);
  if (!text || text.length > 20) return out;
  if (/^[A-Z]{2}:/.test(text)) add(normalizeId(text));
  const a = /^(SH|SZ|BJ)?(\d{6})$/.exec(text);
  if (a) (a[1] ? [`${a[1]}:${a[2]}`] : inferAShare(a[2])).forEach(add);
  const hk = /^(?:HK)?(\d{1,5})$/.exec(text);
  if (hk) add(normalizeId(`HK:${hk[1]}`));
  if (HK_INDEXES.includes(text)) add(`HK:${text}`);
  // 常用指数的叫法（"纳斯达克"、"恒生科技"、"标普"……）
  if (text.length >= 2) for (const [id, names] of INDEX_NAMES) if (names.some((n) => n.toUpperCase() === text || n.toUpperCase().startsWith(text) || text.startsWith(n.toUpperCase()))) add(id);
  if (/^[.^]?[A-Z]{1,5}(\.[A-Z]{1,2})?$/.test(text)) add(normalizeId(`US:${text}`));
  fxCandidates(input).forEach(add);
  return out;
}

/** 搜索结果里显示的"种类" */
export const kindOf = (id) => (id.startsWith("FX:") ? "汇率" : isIndex(id) ? "指数" : "股票");
