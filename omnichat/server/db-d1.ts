import type { DB, SqlValue, Statement } from './db';

/** Cloudflare D1 storage. */
export function d1Database(d1: D1Database): DB {
  const bind = (sql: string, params?: SqlValue[]) => {
    const stmt = d1.prepare(sql);
    return params && params.length ? stmt.bind(...params) : stmt;
  };
  return {
    async all<T>(sql: string, params?: SqlValue[]) {
      const r = await bind(sql, params).all<T>();
      return r.results ?? [];
    },
    async first<T>(sql: string, params?: SqlValue[]) {
      return (await bind(sql, params).first<T>()) ?? null;
    },
    async run(sql: string, params?: SqlValue[]) {
      const r = await bind(sql, params).run();
      return { changes: r.meta?.changes ?? 0 };
    },
    async batch(statements: Statement[]) {
      if (!statements.length) return;
      await d1.batch(statements.map((s) => bind(s.sql, s.params)));
    },
  };
}
