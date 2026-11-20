import { DatabaseSync } from 'node:sqlite';
import type { DB, SqlValue, Statement } from './db';

/** Self-hosted storage backed by Node's built-in SQLite. */
export function sqliteDatabase(file: string): DB {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
  const cache = new Map<string, ReturnType<DatabaseSync['prepare']>>();
  const prep = (sql: string) => {
    let s = cache.get(sql);
    if (!s) {
      s = db.prepare(sql);
      cache.set(sql, s);
    }
    return s;
  };
  const args = (params?: SqlValue[]) => (params ?? []).map((v) => (v === undefined ? null : v));

  return {
    async all<T>(sql: string, params?: SqlValue[]) {
      return prep(sql).all(...args(params)) as T[];
    },
    async first<T>(sql: string, params?: SqlValue[]) {
      return (prep(sql).get(...args(params)) as T | undefined) ?? null;
    },
    async run(sql: string, params?: SqlValue[]) {
      const r = prep(sql).run(...args(params));
      return { changes: Number(r.changes) };
    },
    async batch(statements: Statement[]) {
      db.exec('BEGIN');
      try {
        for (const s of statements) prep(s.sql).run(...args(s.params));
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  };
}
