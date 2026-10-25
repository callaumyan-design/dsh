// Self-hosted entry: serves the built web app and the API from one Node process.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { getConnInfo } from '@hono/node-server/conninfo';
import { Agent, EnvHttpProxyAgent, fetch as undiciFetch } from 'undici';
import { createApp } from './app';
import { sqliteDatabase } from './db-sqlite';
import { hashPassword, randomToken } from './crypto';
import { ensureSchema } from './db';
import { createBackupService } from './backup';
import { APP_VERSION } from '../shared/types';

const env = process.env;
const bool = (v: string | undefined, d = false) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));

const dataDir = path.resolve(env.DATA_DIR || 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = sqliteDatabase(path.join(dataDir, 'omnichat.db'));

function loadSecret(): string {
  if (env.APP_SECRET) return env.APP_SECRET;
  const file = path.join(dataDir, 'secret.key');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const s = randomToken(32);
  fs.writeFileSync(file, s, { mode: 0o600 });
  return s;
}
const secret = loadSecret();

// CLI: node dist/server/index.mjs reset-password <username> <new-password>
if (process.argv[2] === 'reset-password') {
  const [username, password] = process.argv.slice(3);
  if (!username || !password || password.length < 6) {
    console.error('Usage: reset-password <username> <new-password (6+ chars)>');
    process.exit(1);
  }
  await ensureSchema(db);
  const user = await db.first<{ id: string }>('SELECT id FROM users WHERE username = ?', [username]);
  if (!user) {
    console.error(`User not found: ${username}`);
    process.exit(1);
  }
  const hash = await hashPassword(password, Number(env.PASSWORD_ITERATIONS) || 300_000);
  await db.batch([
    { sql: 'UPDATE users SET password_hash = ? WHERE id = ?', params: [hash, user.id] },
    { sql: 'DELETE FROM sessions WHERE user_id = ?', params: [user.id] },
  ]);
  console.log(`Password for "${username}" has been reset. All of its sessions were signed out.`);
  process.exit(0);
}

// Long timeouts: reasoning models can stay silent for minutes. Honors HTTPS_PROXY / HTTP_PROXY / NO_PROXY.
const useEnvProxy = !!(env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy);
const timeouts = { headersTimeout: 15 * 60_000, bodyTimeout: 15 * 60_000 };
const dispatcher = useEnvProxy ? new EnvHttpProxyAgent(timeouts) : new Agent(timeouts);
const upstreamFetch = ((input: string | URL, init?: RequestInit) =>
  undiciFetch(input, { ...(init as object), dispatcher } as Parameters<typeof undiciFetch>[1])) as unknown as typeof fetch;

const trustProxy = bool(env.TRUST_PROXY);
const app = createApp({
  getDb: () => db,
  getSecret: () => secret,
  passwordIterations: () => Number(env.PASSWORD_ITERATIONS) || 300_000,
  defaultAllowRegister: () => bool(env.ALLOW_REGISTER),
  allowPrivateNetwork: () => bool(env.ALLOW_PRIVATE_NETWORK),
  getClientIp: (c) => {
    if (trustProxy) {
      const h = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip');
      if (h) return h;
    }
    try {
      return getConnInfo(c).remote.address ?? 'unknown';
    } catch {
      return 'unknown';
    }
  },
  fetch: upstreamFetch,
  limits: () => ({ maxOps: 500, maxRecordBytes: 48 * 1024 * 1024 }),
  // Daily snapshots in <data>/backups; BACKUP_AZURE_URL (or the Azure VM tag "backup") adds an off-site copy.
  backups: bool(env.BACKUP_DISABLED)
    ? undefined
    : createBackupService({
        db,
        dataDir,
        azureUrl: env.BACKUP_AZURE_URL || undefined,
        keepLocal: Number(env.BACKUP_KEEP) || undefined,
      }),
});

const staticDir = env.STATIC_DIR
  ? path.resolve(env.STATIC_DIR)
  : fileURLToPath(new URL('../client', import.meta.url));

if (fs.existsSync(path.join(staticDir, 'index.html'))) {
  const indexHtml = fs.readFileSync(path.join(staticDir, 'index.html'), 'utf8');
  app.use(
    '/*',
    serveStatic({
      root: staticDir,
      onFound: (p, c) => {
        if (/[\\/]assets[\\/]/.test(p)) c.header('Cache-Control', 'public, max-age=31536000, immutable');
        else c.header('Cache-Control', 'no-cache');
      },
    }),
  );
  // Single-page app fallback.
  app.get('*', (c) => {
    c.header('Cache-Control', 'no-cache');
    return c.html(indexHtml);
  });
} else {
  console.warn(`[omnichat] No web build found at ${staticDir}; serving API only (use "npm run dev" for the UI).`);
}

const port = Number(env.PORT) || (env.NODE_ENV === 'production' ? 3000 : 8787);
const hostname = env.HOST || '0.0.0.0';
serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`[omnichat] v${APP_VERSION} listening on http://${hostname === '0.0.0.0' ? 'localhost' : hostname}:${info.port}`);
  console.log(`[omnichat] data directory: ${dataDir}${useEnvProxy ? ' | outbound proxy: on' : ''}`);
});
