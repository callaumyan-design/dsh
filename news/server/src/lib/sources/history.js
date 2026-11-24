// 补抓历史新闻。订阅源只保留最近几天，所以从三个地方凑：
//   1. 现在的订阅源（有的来源能回到十几天前，比如极客公园）
//   2. 能翻页的订阅源（WordPress 的 ?paged=2、3…，见 config.js 的 pagedUrl）
//   3. 互联网档案馆（Wayback Machine）里订阅源和 GitHub 热榜页面的历史快照
// 先把整个时间段的新闻收进一个“池子”，再按天切出每一期。只读外部网站，不写任何东西。
import { SOURCES } from './config.js';
import { parseFeed, canonicalUrl } from './feed.js';
import { parseTrending } from './github.js';

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; tech-news-reader/1.0; backfill)' };
const WAYBACK = 'https://web.archive.org';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Wayback 的时间戳：yyyyMMddhhmmss（UTC）
export const waybackTs = (d) => d.toISOString().replace(/[-:T]/g, '').slice(0, 14);

/**
 * 第 date 期覆盖的时间：前一天北京时间 06:47 到当天 06:47（和每天定时生成的时刻一致，天与天之间不重叠）。
 * @param {string} date 如 2026-11-20
 */
export function editionWindow(date) {
  const end = new Date(`${date}T06:47:00+08:00`);
  return { start: new Date(end.getTime() - 86400_000), end };
}

/** Wayback 的快照列表（每天最多一张），按时间排序 */
export async function waybackSnapshots(url, from, to, { fetchImpl = fetch, perDay = true } = {}) {
  const q = new URL(`${WAYBACK}/cdx/search/cdx`);
  q.search = new URLSearchParams({ url, from: waybackTs(from), to: waybackTs(to), output: 'json', filter: 'statuscode:200', fl: 'timestamp', ...(perDay ? { collapse: 'timestamp:8' } : {}) });
  const res = await fetchImpl(q, { headers: UA, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Wayback 查询 HTTP ${res.status}`);
  const rows = await res.json();
  return rows.slice(1).map(([ts]) => ts).sort();
}

async function getText(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: UA, signal: AbortSignal.timeout(60_000), redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}
const snapshotUrl = (ts, url) => `${WAYBACK}/web/${ts}id_/${url}`;

/**
 * 收集 [from, to) 之间发布的新闻和新品。
 * @returns {Promise<{items: object[], report: {id: string, name: string, current: number, paged: number, snapshots: number, errors: string[]}[]}>}
 */
export async function collectHistory({ from, to, sources = SOURCES, fetchImpl = fetch, delayMs = 1200, log = console } = {}) {
  const pool = new Map();
  const report = [];
  const add = (items) => {
    let n = 0;
    for (const it of items) {
      if (!it.publishedAt) continue;
      const t = new Date(it.publishedAt).getTime();
      if (t < from.getTime() || t >= to.getTime()) continue;
      const key = canonicalUrl(it.url);
      if (!pool.has(key)) {
        pool.set(key, it);
        n++;
      }
    }
    return n;
  };

  for (const s of sources.filter((x) => x.section !== 'github')) {
    const r = { id: s.id, name: s.name, current: 0, paged: 0, snapshots: 0, errors: [] };
    try {
      r.current = add(parseFeed(await getText(s.url, fetchImpl), s));
    } catch (e) {
      r.errors.push(`订阅源：${e.message}`);
    }
    if (s.pagedUrl) {
      // 一页页往前翻，翻到比开始时间更早为止（最多 25 页）
      for (let n = 2; n <= 25; n++) {
        try {
          const items = parseFeed(await getText(s.pagedUrl.replace('{n}', n), fetchImpl), s);
          r.paged += add(items);
          const oldest = items.map((i) => i.publishedAt).filter(Boolean).sort()[0];
          if (!items.length || (oldest && new Date(oldest) < from)) break;
        } catch (e) {
          r.errors.push(`第 ${n} 页：${e.message}`);
          break;
        }
        await sleep(delayMs / 2);
      }
    }
    try {
      // 快照拍下的是“那一刻订阅源里的内容”，所以往后多查两天，补上最后一天的新闻
      const stamps = await waybackSnapshots(s.url, from, new Date(to.getTime() + 2 * 86400_000), { fetchImpl });
      for (const ts of stamps) {
        await sleep(delayMs);
        try {
          r.snapshots += add(parseFeed(await getText(snapshotUrl(ts, s.url), fetchImpl), s));
        } catch (e) {
          r.errors.push(`快照 ${ts}：${e.message}`);
        }
      }
    } catch (e) {
      r.errors.push(e.message);
    }
    log.log?.(`${s.name}：订阅源 ${r.current}，翻页 ${r.paged}，快照 ${r.snapshots}${r.errors.length ? `（${r.errors.length} 个错误）` : ''}`);
    report.push(r);
    await sleep(delayMs);
  }
  return { items: [...pool.values()], report };
}

/** 某一期的 GitHub 热榜：取这一期时间段里最晚的一张 github.com/trending 快照 */
export async function githubForWindow({ start, end }, { fetchImpl = fetch, source = SOURCES.find((s) => s.id === 'github') } = {}) {
  const stamps = await waybackSnapshots('github.com/trending', start, end, { fetchImpl, perDay: false });
  const ts = stamps.at(-1);
  if (!ts) return [];
  return parseTrending(await getText(snapshotUrl(ts, 'https://github.com/trending'), fetchImpl), source);
}

/** 从池子里切出一期的内容，格式和 collect() 的返回值一样，可以直接交给 buildEdition */
export function sliceForEdition(pool, { start, end }) {
  const inWindow = (it) => {
    const t = new Date(it.publishedAt).getTime();
    return t >= start.getTime() && t < end.getTime();
  };
  return pool.filter(inWindow);
}
