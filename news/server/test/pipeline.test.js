import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEdition, editionDate } from '../src/lib/pipeline.js';

const now = new Date('2026-11-20T22:47:00Z'); // 北京时间 11 月 21 日早上
const n = (id, src, title, extra = {}) => ({ id, sourceId: src, sourceName: src, lang: 'en', section: 'news', title, url: `https://${src}/${id}`, summary: `${title} summary`, publishedAt: '2026-11-20T10:00:00.000Z', image: null, ...extra });
const items = [
  n('a', 'verge', 'Apple launches M6', { image: 'https://img/a.jpg' }),
  n('b', 'ithome', '苹果发布 M6 芯片'),
  n('c', '9to5', 'iPhone 18 leak <script>'),
  n('d', 'deal', '50% off headphones'),
  { id: 'ph1', sourceName: 'Product Hunt', section: 'products', title: 'Notely', url: 'https://ph/notely', summary: 'Notes app', lang: 'en' },
  { id: 'gh-x--y', sourceName: 'GitHub Trending', section: 'github', title: 'x/y', url: 'https://github.com/x/y', summary: 'A tool', lang: 'en', repo: { stars: 10, starsToday: 3 } },
];
const collectImpl = async () => ({ items, status: [{ id: 'verge', ok: true, count: 1 }] });

function fakeAi(handlers) {
  const prompts = [];
  return {
    prompts,
    name: 'fake',
    model: 'fake-1',
    async generateJson(req) {
      prompts.push(req);
      if (req.schema.required.includes('headline')) return handlers.select(req);
      if (req.schema.properties.stories) return handlers.summary(req);
      return handlers.brief(req);
    },
  };
}

test('北京时间日期', () => {
  assert.equal(editionDate(now), '2026-11-21');
});

test('AI 挑选、合并、摘要', async () => {
  const ai = fakeAi({
    select: () => ({ headline: '苹果 M6 发布', stories: [{ items: [0, 1, 99], category: '数码', importance: 5 }, { items: [1, 2], category: '不存在', importance: 9 }] }),
    summary: () => ({ stories: [{ key: '0', title: '苹果发布 M6', summary: '摘要一' }, { key: '1', title: 'iPhone 18 曝光', summary: '摘要二' }] }),
    brief: () => ({ items: [{ key: 'ph1', tagline: '笔记应用', summary: '记笔记' }, { key: 'gh-x--y', tagline: '一个工具', summary: '好用' }] }),
  });
  const ed = await buildEdition({ ai, now, collectImpl });
  assert.equal(ed.date, '2026-11-21');
  assert.equal(ed.headline, '苹果 M6 发布');
  assert.deepEqual(ed.ai, { provider: 'fake', model: 'fake-1' });
  assert.equal(ed.stories.length, 2);
  const [s1, s2] = ed.stories;
  assert.equal(s1.title, '苹果发布 M6');
  assert.deepEqual(s1.sources.map((s) => s.name), ['verge', 'ithome']); // 越界编号被忽略
  assert.equal(s1.image, 'https://img/a.jpg');
  assert.equal(s2.category, '数码'); // AI 给的门类不在分类表里：按关键词（iPhone）归类
  assert.equal(s2.importance, 5); // 限制在 1–5
  assert.deepEqual(s2.sources.map((s) => s.name), ['9to5']); // 编号 1 已被第一件事用掉
  assert.equal(ed.products[0].tagline, '笔记应用');
  assert.equal(ed.github[0].repo.starsToday, 3);
  assert.deepEqual(ed.aiErrors, []);
  // 订阅源里的尖括号不会进入提示词
  assert.ok(!ai.prompts[0].prompt.includes('<script>'));
});

test('AI 失败时退回原标题，并记录原因', async () => {
  const ai = fakeAi({
    select: () => { throw new Error('rate limited'); },
    summary: () => ({ stories: [] }),
    brief: () => { throw new Error('boom'); },
  });
  const ed = await buildEdition({ ai, now, collectImpl, log: { error() {} } });
  assert.equal(ed.headline, null);
  assert.equal(ed.stories.length, 4);
  assert.equal(ed.stories[0].title, 'Apple launches M6');
  assert.ok(ed.stories.every((s) => s.category), '没有 AI 时也要有门类');
  assert.equal(ed.products[0].tagline, null);
  assert.deepEqual(ed.aiErrors.map((e) => e.step), ['news', 'briefs']);
});

test('没有配置 AI', async () => {
  const ed = await buildEdition({ ai: null, now, collectImpl });
  assert.equal(ed.ai, null);
  assert.equal(ed.stories.length, 4);
  assert.equal(ed.stories[0].sources[0].url, 'https://verge/a');
});
