#!/usr/bin/env node
// 检查补抓历史新闻的可行性：每个来源在互联网档案馆（Wayback Machine）里过去 N 天有哪些快照，
// 以及 WordPress 订阅源能不能翻页（?paged=2）。只读，不写任何数据。
//   node scripts/probe-history.js [天数，默认 16]
import { SOURCES } from '../src/lib/sources/config.js';
import { parseFeed } from '../src/lib/sources/feed.js';

const days = Number(process.argv[2] || 16);
const now = new Date();
const from = new Date(now.getTime() - days * 86400e3);
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; tech-news-reader/1.0)' };

async function cdx(url) {
  const q = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(url)}&from=${ymd(from)}&to=${ymd(now)}&output=json&filter=statuscode:200&collapse=timestamp:8&fl=timestamp,mimetype,length`;
  const res = await fetch(q, { headers: UA, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`CDX HTTP ${res.status}`);
  const rows = await res.json();
  return rows.slice(1).map(([ts, mime, len]) => ({ ts, mime, len }));
}

const targets = [...SOURCES.map((s) => ({ id: s.id, url: s.url, s })), { id: 'github(无参数)', url: 'https://github.com/trending', s: null }];
for (const t of targets) {
  try {
    const snaps = await cdx(t.url);
    const daysCovered = [...new Set(snaps.map((x) => x.ts.slice(0, 8)))];
    let sample = '';
    if (snaps.length && t.s && t.s.kind !== 'github-trending') {
      const mid = snaps[Math.floor(snaps.length / 2)];
      const r = await fetch(`https://web.archive.org/web/${mid.ts}id_/${t.url}`, { headers: UA, signal: AbortSignal.timeout(60000) });
      const body = await r.text();
      try {
        const items = parseFeed(body, t.s);
        const dates = items.map((i) => i.publishedAt).filter(Boolean).sort();
        sample = ` | 抽查 ${mid.ts}: HTTP ${r.status} ${items.length} 条 ${dates[0]?.slice(0, 10)}~${dates.at(-1)?.slice(0, 10)}`;
      } catch (e) {
        sample = ` | 抽查 ${mid.ts}: HTTP ${r.status} 解析失败 ${e.message}`;
      }
    }
    console.log(`${t.id}: ${daysCovered.length}/${days} 天有快照 [${daysCovered.map((d) => d.slice(4)).join(' ')}]${sample}`);
  } catch (e) {
    console.log(`${t.id}: 查询失败 ${e.message}`);
  }
  await sleep(1500);
}

// WordPress 翻页
for (const u of ['https://techcrunch.com/feed/', 'https://9to5mac.com/feed/', 'https://www.technologyreview.com/feed/', 'https://www.ifanr.com/feed', 'https://arstechnica.com/feed/']) {
  for (const p of [2, 5, 10]) {
    try {
      const r = await fetch(`${u}?paged=${p}`, { headers: UA, signal: AbortSignal.timeout(30000) });
      const body = await r.text();
      const items = parseFeed(body, { id: 'x', name: 'x', lang: 'en', section: 'news' });
      const dates = items.map((i) => i.publishedAt).filter(Boolean).sort();
      console.log(`翻页 ${u}?paged=${p}: HTTP ${r.status} ${items.length} 条 ${dates[0]?.slice(0, 10)}~${dates.at(-1)?.slice(0, 10)}`);
    } catch (e) {
      console.log(`翻页 ${u}?paged=${p}: 失败 ${e.message}`);
    }
  }
}
