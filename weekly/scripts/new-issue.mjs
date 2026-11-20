#!/usr/bin/env node
// 出一期新的周刊：抓 Trending 周榜 → 补充仓库信息 → 生成中文点评 → 写入 data/issues/<期号>.json
//
// 用法：node scripts/new-issue.mjs [--force] [--no-ai] [--dry-run]
//   --force    本期已存在时覆盖（期数不变）
//   --no-ai    不调用 Claude，只保存榜单数据
//   --dry-run  只打印结果，不写文件
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchTrending, TRENDING_URL } from '../lib/trending.mjs';
import { enrich } from '../lib/github.mjs';
import { writeCommentary } from '../lib/commentary.mjs';
import { reviewWindow, ymd, zhShort } from '../lib/week.mjs';
import { loadIssues } from '../lib/issues.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ISSUES_DIR = path.join(here, '..', 'data', 'issues');
const args = new Set(process.argv.slice(2));

const now = new Date();
const week = reviewWindow(now);
const file = path.join(ISSUES_DIR, `${week.id}.json`);
const existing = loadIssues(ISSUES_DIR);
const previous = existing.find((i) => i.id === week.id);

if (previous && !args.has('--force')) {
  console.log(`本期 ${week.id} 已经存在（第 ${previous.number} 期），跳过。需要重做请加 --force。`);
  process.exit(0);
}

console.log(`▶ 出刊：${week.id}（${ymd(week.start)} ~ ${ymd(week.end)}）`);
const trending = await fetchTrending({ n: 10 });
console.log(`✓ 抓到 Trending 周榜前 ${trending.length} 名`);
const repos = await enrich(trending);
console.log('✓ 已补充仓库信息');

const weekLabel = `${zhShort(week.start)}–${zhShort(week.end)}`;
const ai = args.has('--no-ai') ? null : await writeCommentary(repos, { weekLabel });
if (ai) console.log(`✓ 点评已生成：${ai.headline}`);

const issue = {
  id: week.id,
  number: previous?.number ?? existing.length + 1,
  title: ai?.headline ?? null,
  intro: ai?.intro ?? null,
  publishedAt: now.toISOString(),
  week: { start: ymd(week.start), end: ymd(week.end) },
  source: TRENDING_URL,
  model: ai?.model ?? null,
  items: repos.map(({ readme, ...r }) => {
    const c = ai?.items.get(r.fullName);
    return { ...r, tagline: c?.tagline ?? null, commentary: c?.commentary ?? null, audience: c?.audience ?? null };
  }),
};

const json = `${JSON.stringify(issue, null, 2)}\n`;
if (args.has('--dry-run')) {
  process.stdout.write(json);
} else {
  fs.mkdirSync(ISSUES_DIR, { recursive: true });
  fs.writeFileSync(file, json);
  console.log(`✓ 已写入 ${path.relative(process.cwd(), file)}`);
  // 在 GitHub Actions 里把期号交给后续步骤（写提交信息用）
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `issue=${issue.id}\n`);
}
