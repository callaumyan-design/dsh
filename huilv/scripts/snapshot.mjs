// 生成应用内置的汇率快照 src/data/snapshot.json（网络不通时的兜底数据）。
// 数据来自 npm 上每天发布的 @fawazahmed0/currency-api 包，取最新一天和前一天。
// 用法：node scripts/snapshot.mjs [YYYY-MM-DD]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(path.join(root, 'src/lib/currencies.ts'), 'utf8');
const codes = [...src.matchAll(/code: '([A-Z]{3})'/g)].map((m) => m[1]);

function load(tag) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fx-'));
  try {
    const file = execFileSync('npm', ['pack', `@fawazahmed0/currency-api@${tag}`, '--silent'], { cwd: dir, encoding: 'utf8' }).trim().split('\n').pop();
    execFileSync('tar', ['xzf', file, 'package/v1/currencies/usd.min.json'], { cwd: dir });
    const json = JSON.parse(readFileSync(path.join(dir, 'package/v1/currencies/usd.min.json'), 'utf8'));
    const rates = {};
    for (const c of codes) {
      const v = json.usd[c.toLowerCase()];
      if (typeof v === 'number' && v > 0) rates[c] = Number(v.toPrecision(10));
    }
    rates.USD = 1;
    return { date: json.date, rates };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const latest = load(process.argv[2] ?? 'latest');
const d = new Date(`${latest.date}T00:00:00Z`);
d.setUTCDate(d.getUTCDate() - 1);
const prevDate = d.toISOString().slice(0, 10);
const prev = load(prevDate);
const out = { date: latest.date, prevDate, source: 'fawazahmed0/exchange-api', rates: latest.rates, prev: prev.rates };
writeFileSync(path.join(root, 'src/data/snapshot.json'), JSON.stringify(out, null, 0) + '\n');
const missing = codes.filter((c) => !(c in latest.rates));
console.log(`snapshot ${latest.date} (prev ${prevDate}): ${Object.keys(latest.rates).length} currencies${missing.length ? `, missing ${missing.join(' ')}` : ''}`);
