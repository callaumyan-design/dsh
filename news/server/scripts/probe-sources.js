#!/usr/bin/env node
// 逐个抓取新闻来源，报告每个来源返回了什么，用来排查“抓不到”“条数太少”。
//   node scripts/probe-sources.js            全部来源
//   node scripts/probe-sources.js 36kr huxiu 只看这几个
//   node scripts/probe-sources.js https://example.com/feed   试一个新地址（可以和来源 id 混着写）
import { SOURCES } from '../src/lib/sources/config.js';
import { parseFeed } from '../src/lib/sources/feed.js';
import { parseTrending } from '../src/lib/sources/github.js';

const args = process.argv.slice(2);
const only = args.filter((a) => !/^https?:/.test(a));
const extra = args.filter((a) => /^https?:/.test(a)).map((url) => ({ id: url, name: url, url, lang: 'zh', section: 'news' }));
const now = Date.now();
const list = [...SOURCES.filter((x) => (!only.length && !extra.length) || only.includes(x.id)), ...extra];
for (const s of list) {
  const t0 = Date.now();
  try {
    const res = await fetch(s.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; tech-news-reader/1.0)', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8' },
      signal: AbortSignal.timeout(30000),
      redirect: 'follow',
    });
    const body = await res.text();
    const head = `${s.id} HTTP ${res.status} ${res.headers.get('content-type')} ${body.length}B ${Date.now() - t0}ms 最终地址 ${res.url}`;
    try {
      const items = s.kind === 'github-trending' ? parseTrending(body, s) : parseFeed(body, s);
      const dated = items.filter((i) => i.publishedAt).map((i) => i.publishedAt).sort();
      const fresh = items.filter((i) => !i.publishedAt || now - new Date(i.publishedAt) < 36 * 3600e3).length;
      console.log(`✓ ${head}\n  ${items.length} 条，36 小时内 ${fresh} 条，最早 ${dated[0] ?? '-'}，最晚 ${dated.at(-1) ?? '-'}\n  第一条：${items[0]?.title ?? '-'}`);
    } catch (err) {
      console.log(`✗ ${head}\n  解析失败：${err.message}\n  开头：${body.slice(0, 400).replace(/\s+/g, ' ')}`);
    }
  } catch (err) {
    console.log(`✗ ${s.id} 请求失败：${err.cause?.code ?? ''} ${err.message} (${Date.now() - t0}ms)`);
  }
}
