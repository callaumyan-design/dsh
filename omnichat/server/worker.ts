// Cloudflare Workers entry: the API runs here; static files are served by Workers Assets.
import { createApp } from './app';
import { d1Database } from './db-d1';
import type { DB } from './db';

interface Env {
  DB: D1Database;
  APP_SECRET?: string;
  ALLOW_REGISTER?: string;
  ALLOW_PRIVATE_NETWORK?: string;
  PASSWORD_ITERATIONS?: string;
}

const bool = (v: string | undefined) => !!v && /^(1|true|yes|on)$/i.test(v);
let cached: { d1: D1Database; db: DB } | null = null;
const env = (c: { env: unknown }) => c.env as Env;

const app = createApp({
  getDb: (c) => {
    const d1 = env(c).DB;
    if (!d1) throw new Error('D1 binding "DB" is missing. See wrangler.toml.');
    if (!cached || cached.d1 !== d1) cached = { d1, db: d1Database(d1) };
    return cached.db;
  },
  getSecret: (c) => env(c).APP_SECRET,
  // Workers cap PBKDF2 at 100k iterations and the free plan has a small CPU budget.
  passwordIterations: (c) => Math.min(Number(env(c).PASSWORD_ITERATIONS) || 30_000, 100_000),
  defaultAllowRegister: (c) => bool(env(c).ALLOW_REGISTER),
  allowPrivateNetwork: (c) => bool(env(c).ALLOW_PRIVATE_NETWORK),
  // D1: rows up to ~2 MB, and a small number of queries per request on the free plan.
  limits: () => ({ maxOps: 20, maxRecordBytes: 1_900_000 }),
});

export default app;
