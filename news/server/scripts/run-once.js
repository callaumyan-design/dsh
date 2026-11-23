#!/usr/bin/env node
// 本地试跑一次每日流程，结果写到 ./edition-<日期>.json，不连接 Azure。
// 用法：AI_PROVIDER=... AI_API_KEY=... node scripts/run-once.js
import fs from 'node:fs';
import { createProvider } from '../src/lib/ai/index.js';
import { buildEdition } from '../src/lib/pipeline.js';

const ai = createProvider(process.env);
console.log(ai ? `AI：${ai.name} / ${ai.model}` : '没有配置 AI，只抓取原始新闻');
const edition = await buildEdition({ ai });
const file = `edition-${edition.date}.json`;
fs.writeFileSync(file, JSON.stringify(edition, null, 2));
for (const s of edition.sourceStatus) console.log(`${s.ok ? '✓' : '✗'} ${s.name} ${s.ok ? s.count : s.error}`);
console.log(`→ ${edition.stories.length} 条新闻，${edition.products.length} 个新品，${edition.github.length} 个仓库，已写入 ${file}`);
if (edition.aiErrors.length) console.log('AI 出错：', edition.aiErrors);
