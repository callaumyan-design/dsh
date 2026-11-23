// GitHub Trending 每日榜。GitHub 没有官方 Trending API，只能读页面。
import { parse } from 'node-html-parser';

const toInt = (t) => {
  const m = String(t ?? '').replace(/,/g, '').match(/\d+/);
  return m ? Number(m[0]) : null;
};
const clean = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();

/** 返回 GitHub 给出的顺序。页面结构变了就报错。 */
export function parseTrending(html, source) {
  const rows = parse(html).querySelectorAll('article.Box-row');
  if (!rows.length) throw new Error('Trending 页面里没有找到仓库，页面结构可能变了');
  return rows.map((row, i) => {
    const href = row.querySelector('h2 a')?.getAttribute('href') ?? '';
    const fullName = href.replace(/^\/+/, '').split('/').slice(0, 2).join('/');
    if (!/^[\w.-]+\/[\w.-]+$/.test(fullName)) throw new Error(`第 ${i + 1} 条无法识别仓库名`);
    const url = `https://github.com/${fullName}`;
    const today = clean(row.text).match(/([\d,]+)\s+stars?\s+today/i);
    return {
      id: `gh-${fullName.replace('/', '--')}`,
      sourceId: source.id,
      sourceName: source.name,
      lang: 'en',
      section: source.section,
      title: fullName,
      url,
      summary: clean(row.querySelector('p')?.text),
      publishedAt: null,
      image: null,
      rank: i + 1,
      repo: {
        language: clean(row.querySelector('[itemprop="programmingLanguage"]')?.text) || null,
        stars: toInt(row.querySelector('a[href$="/stargazers"]')?.text),
        starsToday: today ? toInt(today[1]) : null,
      },
    };
  });
}
