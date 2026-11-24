#!/usr/bin/env node
// 补录过去几天的新闻：每天一期，写进“往期”。不推送通知，已有的期默认不覆盖。
//
//   node scripts/backfill.js [天数，默认 15] [--force] [--dry-run]
//   node scripts/backfill.js --dates 2026-11-12,2026-11-17   只重做这几天（会覆盖）
//
// 需要的环境变量和服务器一样：AzureWebJobsStorage（存储）和 AI_*（见 news/README.md）。
// 一般通过 GitHub Actions 的“科技晨读（补录往期）”运行，它会从 Azure 读取这些设置。
// --dry-run：不调用 AI、不写存储，只打印每天能凑到多少条。
import { createProvider } from '../src/lib/ai/index.js';
import { buildEdition, editionDate } from '../src/lib/pipeline.js';
import { azureStore } from '../src/lib/store.js';
import { collectHistory, editionWindow, githubForWindow, sliceForEdition } from '../src/lib/sources/history.js';

const args = process.argv.slice(2);
const days = Number(args.find((a) => /^\d+$/.test(a)) ?? 15);
const only = (args[args.indexOf('--dates') + 1] ?? '').split(',').filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
const force = args.includes('--force') || only.length > 0;
const dryRun = args.includes('--dry-run');

const today = editionDate(new Date());
const dates = [];
if (only.length) dates.push(...only.sort());
else for (let i = days; i >= 1; i--) dates.push(editionDate(new Date(new Date(`${today}T12:00:00+08:00`).getTime() - i * 86400_000)));

const store = dryRun ? null : await azureStore(process.env.AzureWebJobsStorage);
const existing = new Set(store ? (await store.listEditions(400)).map((e) => e.date) : []);
const todo = dates.filter((d) => force || !existing.has(d));
console.log(`补录范围 ${dates[0]} ~ ${dates.at(-1)}，要生成 ${todo.length} 期${todo.length < dates.length ? `（跳过已有的 ${dates.length - todo.length} 期）` : ''}`);
if (!todo.length) process.exit(0);

const from = editionWindow(todo[0]).start;
const to = editionWindow(todo.at(-1)).end;
console.log(`\n▶ 收集 ${from.toISOString()} ~ ${to.toISOString()} 的新闻`);
const { items: pool, report } = await collectHistory({ from, to });
console.log(`共 ${pool.length} 条`);

const ai = dryRun ? null : createProvider(process.env);
if (!dryRun) console.log(ai ? `AI：${ai.name} / ${ai.model}` : '没有配置 AI：显示原标题，门类按关键词归类');

let failed = 0;
for (const date of todo) {
  const win = editionWindow(date);
  const items = sliceForEdition(pool, win);
  let github = [];
  try {
    github = await githubForWindow(win);
  } catch (e) {
    console.log(`  GitHub 热榜快照：${e.message}`);
  }
  const counts = new Map();
  for (const it of items) counts.set(it.sourceName, (counts.get(it.sourceName) ?? 0) + 1);
  const status = report.map((r) => ({ id: r.id, name: r.name, ok: counts.has(r.name), count: counts.get(r.name) ?? 0, ...(counts.has(r.name) ? {} : { error: '这一天没有找到存档' }) }));
  status.push({ id: 'github', name: 'GitHub Trending', ok: github.length > 0, count: github.length, ...(github.length ? {} : { error: '这一天没有找到存档' }) });
  console.log(`\n▶ ${date}：新闻 ${items.filter((i) => i.section === 'news').length} 条，新品 ${items.filter((i) => i.section === 'products').length} 个，GitHub ${github.length} 个；来源 ${[...counts].map(([k, v]) => `${k} ${v}`).join('、')}`);
  if (dryRun) continue;
  try {
    const edition = await buildEdition({ ai, now: win.end, collectImpl: async () => ({ items: [...items, ...github], status }) });
    edition.generatedAt = new Date().toISOString();
    edition.backfilled = { coversFrom: win.start.toISOString(), coversTo: win.end.toISOString() };
    await store.putEdition(edition);
    console.log(`  ✓ 已写入：${edition.stories.length} 条新闻${edition.headline ? `，${edition.headline}` : ''}${edition.aiErrors.length ? `；AI 出错 ${JSON.stringify(edition.aiErrors)}` : ''}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${e.message}`);
  }
}
if (failed) {
  console.log(`\n${failed} 期失败`);
  process.exit(1);
}
