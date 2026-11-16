// 各市场的交易时间和"现在是什么状态"。页面和后台共用，所以这里不能引用别的文件，也不能碰页面。
// 全部按交易所所在时区算（用浏览器 / Workers 自带的 Intl），夏令时自动处理。
// 节假日不写死日历：在本该交易的时段里，如果最新成交时间不是今天，就认为今天休市。

export const ZONES = { A: "Asia/Shanghai", HK: "Asia/Hong_Kong", US: "America/New_York", FX: "America/New_York" };

export const STATUS_TEXT = { open: "交易中", lunch: "午间休市", closed: "已收盘", holiday: "休市", pre: "盘前", post: "盘后" };

const formatters = new Map();
function partsIn(zone, time) {
  if (!formatters.has(zone)) {
    formatters.set(
      zone,
      new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" })
    );
  }
  const p = Object.fromEntries(formatters.get(zone).formatToParts(new Date(time)).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday), // 0 = 周日
    minutes: Number(p.hour) * 60 + Number(p.minute),
    seconds: Number(p.second),
    parts: p,
  };
}

/** 某个时区的"当地日期 + 时刻"换成时间戳。text 形如 "2026-11-16 15:00:03" */
export function zonedToEpoch(zone, text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (!m) return NaN;
  const [y, mo, d, h, mi, s] = m.slice(1).map((v) => Number(v || 0));
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return NaN;
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  // 先按 UTC 猜，再看这个时刻在当地是几点，差多少补多少（夏令时切换那一天也只差一次修正）
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const p = partsIn(zone, t).parts;
    const shown = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
    t += guess - shown;
  }
  return t;
}

const hm = (h, m = 0) => h * 60 + m;

/** 每个市场一天的时段：[开始, 结束, 状态]，没列到的时间算 closed */
const SESSIONS = {
  // A 股：9:15 起集合竞价（算盘前），9:30-11:30、13:00-15:00 连续交易
  A: [
    [0, hm(9, 30), "pre"],
    [hm(9, 30), hm(11, 30), "open"],
    [hm(11, 30), hm(13), "lunch"],
    [hm(13), hm(15), "open"],
  ],
  // 港股：9:00-9:30 开市前时段，9:30-12:00、13:00-16:00 持续交易，16:00-16:10 收市竞价（仍算交易中）
  HK: [
    [0, hm(9, 30), "pre"],
    [hm(9, 30), hm(12), "open"],
    [hm(12), hm(13), "lunch"],
    [hm(13), hm(16, 10), "open"],
  ],
  // 美股：4:00-9:30 盘前，9:30-16:00 常规交易，16:00-20:00 盘后
  US: [
    [hm(4), hm(9, 30), "pre"],
    [hm(9, 30), hm(16), "open"],
    [hm(16), hm(20), "post"],
  ],
};

/** 开盘多久以后才开始用"最新成交时间"判断休市：港股免费行情常有 15 分钟延时，留够余量 */
const HOLIDAY_GRACE = 20;

/**
 * 某个市场现在的状态。
 * group：A / HK / US / FX；now：时间戳；lastTrade：这个市场里最新一笔成交的时间戳（不知道就不传）
 * 返回 open / lunch / closed / holiday / pre / post 之一
 */
export function marketStatus(group, now, lastTrade) {
  const zone = ZONES[group];
  if (!zone) return "closed";
  const t = partsIn(zone, now);
  if (group === "FX") {
    // 外汇：纽约时间周日 17:00 开到周五 17:00
    const w = t.weekday;
    const open = (w >= 1 && w <= 4) || (w === 0 && t.minutes >= hm(17)) || (w === 5 && t.minutes < hm(17));
    return open ? "open" : "holiday";
  }
  if (t.weekday === 0 || t.weekday === 6) return "holiday";
  let status = "closed";
  let start = 0;
  for (const [from, to, s] of SESSIONS[group]) {
    if (t.minutes >= from && t.minutes < to) {
      status = s;
      start = from;
    }
  }
  // 本该交易，但最新成交还停在以前的日子：今天休市（节假日）
  const tradingStarted = status === "lunch" || status === "post" || (status === "open" && t.minutes - start >= HOLIDAY_GRACE) || (status === "open" && start > hm(10));
  if (tradingStarted && Number.isFinite(lastTrade) && lastTrade > 0 && partsIn(zone, lastTrade).date !== t.date) return "holiday";
  return status;
}

/** 这个状态下行情还在变吗（决定刷新频率和后台缓存时间） */
export const isLive = (status) => status === "open" || status === "pre" || status === "post";
