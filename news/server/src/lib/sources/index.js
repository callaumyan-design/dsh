// 抓取全部来源。单个来源失败只记录，不影响其他来源。
import { SOURCES } from './config.js';
import { parseFeed, canonicalUrl } from './feed.js';
import { parseTrending } from './github.js';

const UA = 'Mozilla/5.0 (compatible; tech-news-reader/1.0)';

async function fetchSource(source, fetchImpl) {
  const res = await fetchImpl(source.url, {
    headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8' },
    // 有的来源很慢（极客公园实测 16 秒），给 30 秒
    signal: AbortSignal.timeout(30000),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.text();
  return source.kind === 'github-trending' ? parseTrending(body, source) : parseFeed(body, source);
}

/**
 * @returns {Promise<{items: object[], status: {id: string, name: string, ok: boolean, count: number, error?: string}[]}>}
 */
export async function collect({ sources = SOURCES, fetchImpl = fetch, now = new Date(), maxAgeHours = 36 } = {}) {
  const results = await Promise.allSettled(sources.map((s) => fetchSource(s, fetchImpl)));
  const status = [];
  const all = [];
  results.forEach((r, i) => {
    const s = sources[i];
    if (r.status === 'fulfilled') {
      status.push({ id: s.id, name: s.name, ok: true, count: r.value.length });
      all.push(...r.value);
    } else {
      status.push({ id: s.id, name: s.name, ok: false, count: 0, error: String(r.reason?.message ?? r.reason).slice(0, 200) });
    }
  });

  // 新闻只要最近的。新品和 GitHub 榜单不按时间过滤：Product Hunt 订阅源里的时间是产品最早发布的日子，
  // 不是上榜的日子（实测 50 条里只有 1 条在 36 小时内），所以按订阅源自己的顺序取前几个。
  const cutoff = now.getTime() - maxAgeHours * 3600_000;
  const fresh = all.filter((it) => it.section !== 'news' || !it.publishedAt || new Date(it.publishedAt).getTime() >= cutoff);

  // 同一链接只保留一次
  const seen = new Set();
  const items = fresh.filter((it) => {
    const key = canonicalUrl(it.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { items, status };
}
