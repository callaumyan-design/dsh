import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { collectHistory, editionWindow, githubForWindow, setRetryWaits, sliceForEdition, waybackTs } from '../src/lib/sources/history.js';

setRetryWaits([0, 0, 0]);

const fx = (f) => fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
const rss = (items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${items
  .map(([title, url, date]) => `<item><title>${title}</title><link>${url}</link><pubDate>${new Date(date).toUTCString()}</pubDate></item>`)
  .join('')}</channel></rss>`;

test('每一期覆盖前一天 06:47 到当天 06:47（北京时间）', () => {
  const w = editionWindow('2026-11-20');
  assert.equal(w.start.toISOString(), '2026-11-18T22:47:00.000Z');
  assert.equal(w.end.toISOString(), '2026-11-19T22:47:00.000Z');
  assert.equal(waybackTs(w.end), '20261119224700');
});

test('收集：现在的订阅源 + 翻页 + 档案快照，去重并只保留时间段内的', async () => {
  const src = { id: 'wp', name: 'WP', url: 'https://wp.example/feed/', pagedUrl: 'https://wp.example/feed/?paged={n}', lang: 'en', section: 'news' };
  const from = new Date('2026-11-10T00:00:00Z');
  const to = new Date('2026-11-20T00:00:00Z');
  const calls = [];
  const fetchImpl = async (url) => {
    const u = String(url);
    calls.push(u);
    if (u === src.url) return new Response(rss([['Today', 'https://wp.example/a', '2026-11-19T10:00Z'], ['Too new', 'https://wp.example/new', '2026-11-21T10:00Z']]));
    if (u.endsWith('paged=2')) return new Response(rss([['Mid', 'https://wp.example/b', '2026-11-15T10:00Z'], ['Today again', 'https://wp.example/a?utm_source=x', '2026-11-19T10:00Z']]));
    if (u.endsWith('paged=3')) return new Response(rss([['Old', 'https://wp.example/c', '2026-11-09T10:00Z'], ['Edge', 'https://wp.example/d', '2026-11-10T01:00Z']]));
    if (u.includes('/cdx/search/cdx')) return Response.json([['timestamp'], ['20261112000000']]);
    if (u.includes('/web/20261112000000id_/')) return new Response(rss([['From archive', 'https://wp.example/e', '2026-11-11T10:00Z']]));
    return new Response('nope', { status: 404 });
  };
  const { items, report } = await collectHistory({ from, to, sources: [src], fetchImpl, delayMs: 0, log: {} });
  assert.deepEqual(items.map((i) => i.title).sort(), ['Edge', 'From archive', 'Mid', 'Today']);
  assert.deepEqual(report[0], { id: 'wp', name: 'WP', current: 1, paged: 2, snapshots: 1, errors: [] });
  assert.ok(!calls.some((c) => c.endsWith('paged=4')), '翻到比开始时间更早就停');
  // 按期切分
  const slice = sliceForEdition(items, { start: new Date('2026-11-15T00:00:00Z'), end: new Date('2026-11-20T00:00:00Z') });
  assert.deepEqual(slice.map((i) => i.title).sort(), ['Mid', 'Today']);
});

test('收集：单个来源出错只记录，不中断', async () => {
  const src = { id: 'x', name: 'X', url: 'https://x/feed', lang: 'zh', section: 'news' };
  const fetchImpl = async (url) => (String(url).includes('cdx') ? new Response('busy', { status: 503 }) : new Response('gone', { status: 404 }));
  const { items, report } = await collectHistory({ from: new Date(0), to: new Date(), sources: [src], fetchImpl, delayMs: 0, log: {} });
  assert.equal(items.length, 0);
  assert.equal(report[0].errors.length, 2);
});

test('GitHub 热榜：取这一期时间段里最晚的快照', async () => {
  let fetched;
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes('cdx')) return Response.json([['timestamp'], ['20261119080000'], ['20261119200000']]);
    fetched = u;
    return new Response(fx('trending-daily.html'));
  };
  const items = await githubForWindow(editionWindow('2026-11-20'), { fetchImpl });
  assert.equal(items.length, 3);
  assert.match(fetched, /\/web\/20261119200000id_\/https:\/\/github\.com\/trending$/);
  const none = await githubForWindow(editionWindow('2026-11-20'), { fetchImpl: async () => Response.json([['timestamp']]) });
  assert.deepEqual(none, []);
});

test('档案馆暂时连不上时自动重试', async () => {
  let n = 0;
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes('cdx')) {
      n++;
      if (n === 1) throw new TypeError('fetch failed');
      if (n === 2) return new Response('slow down', { status: 429 });
      return Response.json([['timestamp'], ['20261119200000']]);
    }
    return new Response(fx('trending-daily.html'));
  };
  const items = await githubForWindow(editionWindow('2026-11-20'), { fetchImpl });
  assert.equal(n, 3);
  assert.equal(items.length, 3);
});

test('404 不重试', async () => {
  let n = 0;
  const fetchImpl = async () => {
    n++;
    return new Response('nope', { status: 404 });
  };
  await assert.rejects(githubForWindow(editionWindow('2026-11-20'), { fetchImpl }), /HTTP 404/);
  assert.equal(n, 1);
});
