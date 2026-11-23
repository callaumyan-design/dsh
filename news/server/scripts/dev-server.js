#!/usr/bin/env node
// 本地开发服务器：真实的接口代码 + 内存存储 + 一期示例数据。不连接 Azure。
//   node scripts/dev-server.js            接口在 http://localhost:7071/api/v1
//   APP_ORIGINS=http://localhost:4174 RP_ID=localhost node scripts/dev-server.js
import http from 'node:http';
import fs from 'node:fs';
import { createApi } from '../src/lib/api.js';
import { memoryStore } from '../src/lib/store.js';

const port = Number(process.env.PORT || 7071);
const env = {
  APP_ORIGINS: process.env.APP_ORIGINS || 'http://localhost:4174,http://localhost:5173',
  RP_ID: process.env.RP_ID || 'localhost',
  RP_NAME: '科技晨读（本地）',
  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
};
const store = memoryStore();
const sample = JSON.parse(fs.readFileSync(new URL('../test/fixtures/sample-edition.json', import.meta.url), 'utf8'));
await store.putEdition(sample);
await store.putEdition({ ...sample, date: '2026-11-20', headline: '示例数据：前一天的一期', generatedAt: '2026-11-19T22:52:00.000Z' });
const handle = createApi({ store, env });

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/api/v1/')) return res.writeHead(404).end();
    let body;
    if (req.method === 'POST' || req.method === 'PUT') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const text = Buffer.concat(chunks).toString('utf8');
      body = text ? JSON.parse(text) : {};
    }
    const out = await handle({ method: req.method, path: url.pathname.slice(7), headers: req.headers, body });
    res.writeHead(out.status, { ...(out.json !== undefined ? { 'Content-Type': 'application/json; charset=utf-8' } : {}), ...out.headers });
    res.end(out.json !== undefined ? JSON.stringify(out.json) : undefined);
  })
  .listen(port, () => console.log(`接口：http://localhost:${port}/api/v1（允许来源：${env.APP_ORIGINS}）`));
