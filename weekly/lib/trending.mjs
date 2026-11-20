// 解析 https://github.com/trending?since=weekly 页面。
// GitHub 没有官方的 Trending API，只能读页面；结构变了就让这里报错，而不是悄悄换口径。
import { parse } from 'node-html-parser';

export const TRENDING_URL = 'https://github.com/trending?since=weekly';

const toInt = (text) => {
  const m = String(text ?? '').replace(/,/g, '').match(/\d+/);
  return m ? Number(m[0]) : null;
};

const clean = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

/** 把 Trending 页面的 HTML 解析成仓库列表，顺序即 GitHub 给出的排名。 */
export function parseTrending(html) {
  const root = parse(html);
  const rows = root.querySelectorAll('article.Box-row');
  return rows.map((row, i) => {
    const link = row.querySelector('h2 a');
    const href = link?.getAttribute('href') ?? '';
    const fullName = href.replace(/^\/+/, '').split('/').slice(0, 2).join('/');
    if (!/^[\w.-]+\/[\w.-]+$/.test(fullName)) {
      throw new Error(`第 ${i + 1} 条无法识别仓库名（href="${href}"），Trending 页面结构可能变了`);
    }
    const langEl = row.querySelector('[itemprop="programmingLanguage"]');
    const colorStyle = row.querySelector('.repo-language-color')?.getAttribute('style') ?? '';
    const color = colorStyle.match(/#[0-9a-fA-F]{3,8}/)?.[0] ?? null;
    const starsEl = row.querySelector(`a[href$="/stargazers"]`);
    const forksEl = row.querySelector(`a[href$="/forks"]`) ?? row.querySelector(`a[href$="/network/members"]`);
    const weekly = clean(row.text).match(/([\d,]+)\s+stars?\s+this\s+week/i);
    return {
      rank: i + 1,
      fullName,
      url: `https://github.com/${fullName}`,
      description: clean(row.querySelector('p')?.text) || null,
      language: clean(langEl?.text) || null,
      languageColor: color,
      stars: toInt(starsEl?.text),
      forks: toInt(forksEl?.text),
      starsThisWeek: weekly ? toInt(weekly[1]) : null,
    };
  });
}

/** 抓取并返回前 n 名。页面没有足够的条目或缺少关键字段时直接报错。 */
export async function fetchTrending({ n = 10, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(TRENDING_URL, {
    headers: {
      'User-Agent': 'github-weekly-bot (+https://github.com)',
      'Accept': 'text/html',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`抓取 Trending 失败：HTTP ${res.status}`);
  const repos = parseTrending(await res.text());
  if (repos.length < n) {
    throw new Error(`Trending 页面只解析出 ${repos.length} 个仓库（需要 ${n} 个），页面结构可能变了`);
  }
  const top = repos.slice(0, n);
  const broken = top.filter((r) => r.stars == null || r.starsThisWeek == null);
  if (broken.length) {
    throw new Error(`以下仓库缺少 star 数据，页面结构可能变了：${broken.map((r) => r.fullName).join(', ')}`);
  }
  return top;
}
