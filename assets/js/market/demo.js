// 演示数据：网址带 ?demo=quotes 时用这些假数据，方便没有后台时预览卡片。卡片上会明确标出"演示数据"。
const TABLE = {
  "SH:000001": ["上证指数", 3366.12, 3350.0],
  "SZ:000001": ["平安银行", 11.52, 11.6],
  "SH:600519": ["贵州茅台", 1459.0, 1449.0],
  "SZ:399001": ["深证成指", 10650.3, 10700.1],
  "BJ:920118": ["太湖远大", 27.31, 27.31],
  "HK:HSI": ["恒生指数", 17500.5, 17600.0],
  "HK:00700": ["腾讯控股", 380.2, 378.0],
  "US:.IXIC": ["纳斯达克综合指数", 15000.1, 14900.1],
  "US:NVDA": ["英伟达", 150.0, 147.0],
  "US:AAPL": ["苹果", 191.56, 188.63],
  "FX:AUDCNY": ["澳元/人民币（在岸）", 4.6512, 4.64],
  "FX:USDCNY": ["美元/人民币（在岸）", 7.241, 7.238],
  "FX:USDCNH": ["美元/人民币（离岸）", 7.284, 7.28],
};

const CURRENCY = { SH: "CNY", SZ: "CNY", BJ: "CNY", HK: "HKD", US: "USD" };
const INDEX = /^(US:\.|HK:[A-Z]|SH:000|SZ:399)/;

/** 和 /api/quotes 一样的返回格式 */
export function demoQuotes(ids, now = Date.now()) {
  const quotes = [];
  const errors = [];
  for (const id of ids) {
    const row = TABLE[id];
    if (!row) {
      errors.push({ id, reason: "演示数据里没有这个代码" });
      continue;
    }
    const [name, price, prev] = row;
    const market = id.split(":")[0];
    const q = {
      id,
      name,
      price,
      change: Math.round((price - prev) * 1e6) / 1e6,
      changePct: Math.round(((price - prev) / prev) * 1e6) / 1e4,
      currency: INDEX.test(id) ? "" : market === "FX" ? id.slice(6) : CURRENCY[market],
      time: now - 60000,
      delayed: market === "HK",
      reference: false,
      source: "demo",
    };
    if (id === "US:NVDA") q.extended = { label: "盘后", price: 151.2, change: 1.2, changePct: 0.8, time: now - 30000 };
    quotes.push(q);
  }
  return { quotes, errors, at: now };
}

/** 演示用的搜索：在上面这张表里按名称或代码找，格式和 /api/quotes/search 一样 */
export function demoSearch(q, now = Date.now()) {
  const text = String(q || "").trim().toLowerCase();
  const ids = Object.keys(TABLE).filter((id) => id.toLowerCase().includes(text) || TABLE[id][0].toLowerCase().includes(text));
  const { quotes } = demoQuotes(ids, now);
  return { results: quotes.map((quote) => ({ id: quote.id, name: quote.name, kind: quote.id.startsWith("FX:") ? "汇率" : INDEX.test(quote.id) ? "指数" : "股票", quote })), at: now };
}
