import fs from 'node:fs';
import path from 'node:path';

/** 读取目录下所有期刊，按期号从新到旧排序。 */
export function loadIssues(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}-W\d{2}\.json$/.test(f))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
    .sort((a, b) => b.id.localeCompare(a.id));
}
