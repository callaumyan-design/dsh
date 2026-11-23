import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseFeed, canonicalUrl, stripHtml, itemId } from '../src/lib/sources/feed.js';
import { parseTrending } from '../src/lib/sources/github.js';
import { collect } from '../src/lib/sources/index.js';

const fx = (f) => fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
const src = { id: 'ex', name: 'Example', lang: 'en', section: 'news' };

test('RSS 2.0（WordPress 风格）', () => {
  const items = parseFeed(fx('wordpress.xml'), src);
  assert.equal(items.length, 3); // 缺标题和链接的那条被跳过
  const [a, b] = items;
  assert.equal(a.title, 'Apple announces M6 chips & new MacBook Pro');
  assert.equal(a.summary, 'Apple today unveiled the M6 family.\nThe new chips are built on a 2nm process — a first for Macs.');
  assert.equal(a.publishedAt, '2026-11-20T08:30:00.000Z');
  assert.equal(a.image, 'https://cdn.example.com/m6.jpg');
  assert.equal(a.sourceName, 'Example');
  assert.equal(b.title, '小米发布新款手机');
  assert.equal(b.image, 'https://cdn.example.com/xiaomi.jpg');
});

test('Atom', () => {
  const [e] = parseFeed(fx('atom.xml'), src);
  assert.equal(e.title, 'Samsung’s tri-fold phone gets a US release date');
  assert.equal(e.url, 'https://www.example.com/news/1/samsung-trifold');
  assert.equal(e.summary, 'The Galaxy Z TriFold arrives next month.');
  assert.equal(e.publishedAt, '2026-11-20T15:00:00.000Z');
  assert.equal(e.image, 'https://cdn.example.com/fold.jpg');
});

test('不是订阅源时报错', () => {
  assert.throws(() => parseFeed('<html><body>hi</body></html>', src), /不是 RSS 或 Atom/);
});

test('链接规范化与去重键', () => {
  assert.equal(canonicalUrl('http://www.a.com/x/?utm_source=rss&id=3#top'), 'https://a.com/x/?id=3');
  assert.equal(itemId('https://a.com/x?utm_medium=1'), itemId('http://www.a.com/x/'));
  assert.equal(stripHtml('<p>a&nbsp;&amp;&#x4e2d;</p><script>x</script>'), 'a &中');
});

test('GitHub Trending 每日榜（真实页面）', () => {
  const items = parseTrending(fx('trending-daily.html'), { id: 'github', name: 'GitHub Trending', section: 'github' });
  assert.equal(items.length, 3);
  for (const it of items) {
    assert.match(it.title, /^[\w.-]+\/[\w.-]+$/);
    assert.ok(it.repo.stars > 0 && it.repo.starsToday > 0, JSON.stringify(it.repo));
  }
  assert.deepEqual(items.map((i) => i.rank), [1, 2, 3]);
});

test('collect：单个来源失败不影响其他、过滤旧闻、合并重复链接', async () => {
  const sources = [
    { id: 'a', name: 'A', url: 'https://a/feed', lang: 'en', section: 'news' },
    { id: 'b', name: 'B', url: 'https://b/feed', lang: 'en', section: 'news' },
    { id: 'c', name: 'C', url: 'https://c/feed', lang: 'en', section: 'news' },
  ];
  const fetchImpl = async (url) => {
    if (url.startsWith('https://c')) return new Response('gone', { status: 404 });
    return new Response(fx('wordpress.xml'));
  };
  const { items, status } = await collect({ sources, fetchImpl, now: new Date('2026-11-20T12:00:00Z') });
  assert.deepEqual(status.map((s) => [s.id, s.ok, s.count]), [['a', true, 3], ['b', true, 3], ['c', false, 0]]);
  assert.match(status[2].error, /404/);
  // a、b 内容相同：重复链接只留一份；10 月的旧闻被过滤
  assert.deepEqual(items.map((i) => i.title), ['Apple announces M6 chips & new MacBook Pro', '小米发布新款手机']);
});
