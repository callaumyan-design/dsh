// 行情代码的统一格式、校验和推断。页面和后台（tools/worker/quotes.js）共用这一个文件，
// 所以这里不能引用别的文件，也不能碰页面（document、window）。
//
// 统一格式："市场:代码"
//   SH:600519  沪市（含上证指数 SH:000001、沪深300 SH:000300、沪市基金 5 开头）
//   SZ:000001  深市（含深证成指 SZ:399001、创业板指 SZ:399006、深市基金 1 开头）
//   BJ:920xxx  北交所（2025-10-09 起股票全部是 920 开头；北证50 指数 BJ:899050）
//   HK:00700   港股（5 位数字）；港股指数用字母：HK:HSI 恒生指数、HK:HSCEI 国企指数、HK:HSTECH 恒生科技
//   US:NVDA    美股（BRK.B 这类带点的也行）；美股指数前面带点：US:.IXIC 纳斯达克综合、US:.DJI 道琼斯、US:.INX 标普500
//   FX:AUDCNY  汇率：前 3 个字母是"1 个单位的什么"，后 3 个字母是"换成多少什么"。CNY 是在岸人民币，CNH 是离岸人民币

/** 市场分组（卡片上按这个顺序显示） */
export const GROUPS = [
  { id: "A", name: "A 股", markets: ["SH", "SZ", "BJ"] },
  { id: "HK", name: "港股", markets: ["HK"] },
  { id: "US", name: "美股", markets: ["US"] },
  { id: "FX", name: "汇率", markets: ["FX"] },
];

export const groupOf = (id) => GROUPS.find((g) => g.markets.includes(id.split(":")[0]))?.id || "";

/** 汇率能用的币种 */
export const CURRENCIES = {
  CNY: "人民币（在岸）",
  CNH: "人民币（离岸）",
  USD: "美元",
  AUD: "澳元",
  HKD: "港币",
  EUR: "欧元",
  GBP: "英镑",
  JPY: "日元",
  NZD: "新西兰元",
  CAD: "加元",
  SGD: "新加坡元",
  CHF: "瑞士法郎",
  KRW: "韩元",
  TWD: "新台币",
};

const PATTERNS = {
  SH: /^\d{6}$/,
  SZ: /^\d{6}$/,
  BJ: /^\d{6}$/,
  HK: /^(\d{5}|[A-Z]{2,8})$/,
  US: /^\.?[A-Z]{1,5}(\.[A-Z]{1,2})?$/,
  FX: /^[A-Z]{6}$/,
};

/**
 * 把任意写法整理成统一格式；不合法返回空字符串。
 * 例：" hk:700 " → "HK:00700"，"us:^ixic" → "US:.IXIC"，"fx:aud/cny" → "FX:AUDCNY"
 */
export function normalizeId(raw) {
  if (typeof raw !== "string" || raw.length > 24) return "";
  const m = /^\s*([A-Za-z]{2}):\s*(.+?)\s*$/.exec(raw);
  if (!m) return "";
  const market = m[1].toUpperCase();
  let code = m[2].toUpperCase();
  if (!Object.hasOwn(PATTERNS, market)) return "";
  if (market === "FX") code = code.replace(/^([A-Z]{3})\/([A-Z]{3})$/, "$1$2"); // AUD/CNY 也认
  if (market === "HK" && /^\d{1,5}$/.test(code)) code = code.padStart(5, "0");
  if (market === "US") code = code.replace(/^\^/, ".");
  if (!PATTERNS[market].test(code)) return "";
  if (market === "FX") {
    const base = code.slice(0, 3);
    const quote = code.slice(3);
    if (base === quote || !Object.hasOwn(CURRENCIES, base) || !Object.hasOwn(CURRENCIES, quote)) return "";
  }
  return `${market}:${code}`;
}

export const isIndex = (id) => /^US:\./.test(id) || /^HK:[A-Z]/.test(id) || /^SH:000/.test(id) || /^SZ:399/.test(id) || /^BJ:899/.test(id);

/** 汇率代码的中文名，如 FX:AUDCNY → "澳元/人民币（在岸）" */
export function fxName(id) {
  const code = id.slice(3);
  const base = CURRENCIES[code.slice(0, 3)];
  const quote = CURRENCIES[code.slice(3)];
  return base && quote ? `${base.replace(/（.*）/, "")}/${quote}` : id;
}

/**
 * A 股：只给 6 位数字时，推断是哪个交易所。返回所有可能，第一个最常见。
 *   6、9（沪 B 股）、5（沪市基金）开头 → 沪市
 *   0、2（深 B 股）、3、1（深市基金）开头 → 深市
 *   920（北交所股票）、899（北证指数）、4、8 开头（北交所旧代码）→ 北交所
 *   000 开头既可能是深市股票（000001 平安银行），也可能是沪市指数（000001 上证指数）→ 两个都给，让用户选
 */
export function inferAShare(code) {
  const c = String(code || "").trim();
  if (!/^\d{6}$/.test(c)) return [];
  if (c.startsWith("000")) return [`SZ:${c}`, `SH:${c}`];
  if (/^(920|899)/.test(c) || /^[48]/.test(c)) return [`BJ:${c}`];
  if (/^[695]/.test(c)) return [`SH:${c}`];
  if (/^[0231]/.test(c)) return [`SZ:${c}`];
  return [];
}

/**
 * 添加时"先选市场再输入代码"：把用户在某个市场下输入的代码变成候选的统一代码。
 * market 是 GROUPS 里的 id（A / HK / US / FX）
 */
export function candidatesFor(market, input) {
  const text = String(input || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!text || text.length > 16) return [];
  // 已经写成"市场:代码"的，直接用
  if (text.includes(":")) {
    const id = normalizeId(text);
    return id && groupOf(id) === market ? [id] : [];
  }
  if (market === "A") {
    const m = /^(SH|SZ|BJ)?(\d{6})$/.exec(text);
    if (!m) return [];
    return m[1] ? [`${m[1]}:${m[2]}`] : inferAShare(m[2]);
  }
  const id = normalizeId(`${market}:${text}`);
  return id ? [id] : [];
}

/** 第一次用时的示例 */
export const DEFAULT_WATCHLIST = [
  { id: "SH:000001", name: "上证指数" },
  { id: "HK:HSI", name: "恒生指数" },
  { id: "US:.IXIC", name: "纳斯达克综合指数" },
  { id: "FX:AUDCNY", name: "澳元/人民币（在岸）" },
  { id: "FX:USDCNY", name: "美元/人民币（在岸）" },
];

/** 一次最多查多少个代码 */
export const MAX_IDS = 40;
