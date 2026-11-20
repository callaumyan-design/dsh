// 把期刊数据渲染成静态 HTML / RSS。没有模板引擎：所有插入的文本都经过 esc()。
import { zhDate } from './week.mjs';

export const SITE_NAME = 'GitHub 热榜周刊';
const FONTS =
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=Noto+Serif+SC:wght@700;900&display=swap';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const day = (s) => new Date(`${s}T00:00:00Z`);
const range = (issue) => {
  const a = day(issue.week.start);
  const b = day(issue.week.end);
  return `${zhDate(a)} – ${b.getUTCMonth() + 1}月${b.getUTCDate()}日`;
};
export const issueTitle = (issue) => issue.title ?? `GitHub Trending 周榜 · 第 ${issue.number} 期`;

/** 只接受 #rgb / #rrggbb 这类颜色，避免把任意字符串写进 style。 */
const safeColor = (c) => (/^#[0-9a-fA-F]{3,8}$/.test(c ?? '') ? c : null);

function renderEntry(item, maxWeekly) {
  const [owner, name] = item.fullName.split('/');
  const pct = maxWeekly ? Math.max(4, Math.round((item.starsThisWeek / maxWeekly) * 100)) : 0;
  const color = safeColor(item.languageColor);
  const hasAi = Boolean(item.commentary);
  const topics = (item.topics ?? []).slice(0, 5);
  return `
<li class="entry" id="${esc(item.fullName.replace('/', '--'))}">
  <div class="rank" aria-label="第 ${item.rank} 名">${item.rank}</div>
  <div class="entry-body">
    <div class="entry-top">
      <a class="repo" href="${esc(item.url)}" target="_blank" rel="noopener"><span class="owner">${esc(owner)} / </span><span class="name">${esc(name)}</span></a>
      <div class="weekly" title="本周新增 star">
        <span class="weekly-num">+${num(item.starsThisWeek)}<small>本周 star</small></span>
        <span class="bar" aria-hidden="true"><span style="width:${pct}%"></span></span>
      </div>
    </div>
    ${item.tagline ? `<h3 class="tagline">${esc(item.tagline)}</h3>` : ''}
    ${hasAi ? `<p class="commentary">${esc(item.commentary)}</p>` : ''}
    ${item.audience ? `<p class="audience"><b>适合</b>${esc(item.audience)}</p>` : ''}
    ${item.description ? `<p class="original${hasAi ? '' : ' plain'}" lang="en">${esc(item.description)}</p>` : ''}
    <div class="meta">
      ${item.language ? `<span class="lang"><span class="dot"${color ? ` style="background:${color}"` : ''}></span>${esc(item.language)}</span>` : ''}
      <span>★ ${num(item.stars)}</span>
      <span>Fork ${num(item.forks)}</span>
      ${item.license ? `<span>${esc(item.license)}</span>` : ''}
      ${item.createdAt ? `<span>创建于 ${esc(item.createdAt.slice(0, 7))}</span>` : ''}
      ${item.homepage ? `<a href="${esc(item.homepage)}" target="_blank" rel="noopener">主页</a>` : ''}
    </div>
    ${topics.length ? `<div class="topics">${topics.map((t) => `<span class="topic">${esc(t)}</span>`).join('')}</div>` : ''}
  </div>
</li>`;
}

function renderArchive(issues, base) {
  if (!issues.length) return '';
  return `
<h2 class="section-title">往期</h2>
<ol class="archive">
${issues
  .map(
    (i) => `  <li><span class="no">第 ${i.number} 期</span><a href="${base}issues/${esc(i.id)}.html">${esc(issueTitle(i))}<span class="range">${esc(range(i))}</span></a></li>`,
  )
  .join('\n')}
</ol>`;
}

function footer(issue, base) {
  return `
<footer class="footer">
  ${issue ? `<p>榜单来自 <a href="${esc(issue.source)}" target="_blank" rel="noopener">GitHub Trending 周榜</a>，排名与 star 数为出刊时（${esc(issue.publishedAt.slice(0, 10))}）的数据。</p>` : ''}
  ${issue?.model ? '<p>标题、导语与项目点评由 AI 根据项目简介和 README 生成，可能有疏漏，以项目原文为准。</p>' : ''}
  <p>每周一更新 · <a href="${base}feed.xml">RSS 订阅</a></p>
</footer>`;
}

/** 一期的正文（刊头 + 榜单）。 */
export function renderIssueBody(issue, { base, archive = [], pager = null }) {
  const maxWeekly = Math.max(...issue.items.map((i) => i.starsThisWeek ?? 0));
  return `
<main class="wrap">
  <header class="masthead">
    <div class="nameplate">
      <a class="brand" href="${base}index.html">${SITE_NAME}</a>
      <span><span class="issue-no">第 ${issue.number} 期 · ${esc(issue.id)}</span></span>
    </div>
    <h1 class="headline">${esc(issueTitle(issue))}</h1>
    ${issue.intro ? `<p class="intro">${esc(issue.intro)}</p>` : ''}
    <div class="dateline">${esc(range(issue))} · GitHub Trending 周榜前 ${issue.items.length} 名，按 GitHub 给出的排名</div>
  </header>
  <ol class="list">${issue.items.map((it) => renderEntry(it, maxWeekly)).join('')}
  </ol>
  ${pager ?? ''}
  ${renderArchive(archive, base)}
  ${footer(issue, base)}
</main>`;
}

function emptyBody(base) {
  return `
<main class="wrap">
  <header class="masthead">
    <div class="nameplate"><a class="brand" href="${base}index.html">${SITE_NAME}</a></div>
    <h1 class="headline">第一期即将出刊</h1>
    <p class="intro">每周一整理 GitHub Trending 周榜前十名，附中文点评。</p>
  </header>
  ${footer(null, base)}
</main>`;
}

function page({ title, description, base, body, feed = true }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="${base}style.css">
${feed ? `<link rel="alternate" type="application/rss+xml" title="${SITE_NAME}" href="${base}feed.xml">` : ''}
</head>
<body>${body}
</body>
</html>
`;
}

const describe = (issue) =>
  issue.intro ?? `${range(issue)} GitHub Trending 周榜前 ${issue.items.length} 名：${issue.items.slice(0, 3).map((i) => i.fullName).join('、')} 等`;

/** 首页：最新一期全文 + 往期目录。issues 按从新到旧排序。 */
export function renderIndex(issues) {
  const base = './';
  if (!issues.length) {
    return page({ title: SITE_NAME, description: 'GitHub Trending 周榜前十名，附中文点评', base, body: emptyBody(base) });
  }
  const [latest, ...older] = issues;
  return page({
    title: `${SITE_NAME} · 第 ${latest.number} 期`,
    description: describe(latest),
    base,
    body: renderIssueBody(latest, { base, archive: older }),
  });
}

/** 单期页面，位于 issues/ 子目录。 */
export function renderIssuePage(issue, issues) {
  const base = '../';
  const idx = issues.findIndex((i) => i.id === issue.id);
  const newer = issues[idx - 1];
  const older = issues[idx + 1];
  const pager = `<nav class="pager">
    <span>${older ? `<a href="${esc(older.id)}.html">← 第 ${older.number} 期</a>` : ''}</span>
    <span>${newer ? `<a href="${esc(newer.id)}.html">第 ${newer.number} 期 →</a>` : ''}</span>
  </nav>`;
  return page({
    title: `${issueTitle(issue)} · ${SITE_NAME} 第 ${issue.number} 期`,
    description: describe(issue),
    base,
    body: renderIssueBody(issue, { base, pager }),
  });
}

/** RSS 2.0。siteUrl 需要是以 / 结尾的绝对地址。 */
export function renderFeed(issues, siteUrl) {
  const items = issues.slice(0, 20).map((i) => {
    const link = `${siteUrl}issues/${i.id}.html`;
    const list = i.items
      .map((it) => `<li><a href="${esc(it.url)}">${esc(it.fullName)}</a> +${num(it.starsThisWeek)} ★ — ${esc(it.tagline ?? it.description ?? '')}</li>`)
      .join('');
    const html = `${i.intro ? `<p>${esc(i.intro)}</p>` : ''}<ol>${list}</ol>`;
    return `  <item>
    <title>${esc(`第 ${i.number} 期：${issueTitle(i)}`)}</title>
    <link>${esc(link)}</link>
    <guid isPermaLink="true">${esc(link)}</guid>
    <pubDate>${new Date(i.publishedAt).toUTCString()}</pubDate>
    <description>${esc(html)}</description>
  </item>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>${SITE_NAME}</title>
  <link>${esc(siteUrl)}</link>
  <description>每周 GitHub Trending 周榜前十名，附中文点评</description>
  <language>zh-CN</language>
${items.join('\n')}
</channel>
</rss>
`;
}
