import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import type { DB, Statement } from './db';
import { ensureSchema } from './db';
import {
  decryptSecret,
  encryptSecret,
  hashPassword,
  maskKey,
  randomId,
  randomToken,
  sha256Hex,
  verifyPassword,
} from './crypto';
import { ANTHROPIC_DEFAULT_VERSION, applyAuth, joinUrl } from '../shared/provider-auth';
import {
  APP_VERSION,
  ENTITY_KINDS,
  type AuthStatus,
  type EntityKind,
  type ProviderData,
  type PublicUser,
  type PushOp,
} from '../shared/types';

export interface AppOptions {
  getDb(c: Context): DB;
  /** Secret used to encrypt stored API keys. Falls back to a random secret kept in the database. */
  getSecret?(c: Context): string | undefined;
  passwordIterations(c: Context): number;
  /** Whether new accounts may register after the first (admin) account exists, until an admin changes it. */
  defaultAllowRegister(c: Context): boolean;
  /** Whether non-admin users may point providers at private / loopback addresses. */
  allowPrivateNetwork(c: Context): boolean;
  getClientIp?(c: Context): string;
  /** Upstream fetch implementation (Node uses undici for proxies and long timeouts). */
  fetch?: typeof fetch;
  sessionDays?: number;
  /** Per-push limits; Workers + D1 need much smaller values than SQLite. */
  limits(c: Context): SyncLimits;
}

export interface SyncLimits {
  maxOps: number;
  maxRecordBytes: number;
}

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  is_admin: number;
  created_at: number;
}

type Vars = { db: DB; user: UserRow; sessionId: string };
type AppEnv = { Variables: Vars; Bindings: object };

let lastTs = 0;
/** Monotonic millisecond clock used for sync cursors. */
function now(): number {
  const t = Date.now();
  lastTs = t > lastTs ? t : lastTs + 1;
  return lastTs;
}

const publicUser = (u: UserRow): PublicUser => ({
  id: u.id,
  username: u.username,
  isAdmin: !!u.is_admin,
  createdAt: u.created_at,
});

function fail(status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 502, message: string): never {
  throw new HTTPException(status, { message });
}

function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (/^\d+$/.test(h)) return true; // integer-encoded IPv4
  if (/^(127|10|0)\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)) return true;
  if (h.includes(':')) {
    if (h === '::1' || h === '::') return true;
    if (/^(fc|fd|fe8|fe9|fea|feb)/.test(h)) return true;
    if (h.startsWith('::ffff:')) return isPrivateHost(h.slice(7));
  }
  return false;
}

const loginFailures = new Map<string, { count: number; until: number }>();
function checkThrottle(ip: string) {
  const r = loginFailures.get(ip);
  if (r && r.count >= 8 && r.until > Date.now()) fail(429, 'Too many failed attempts. Try again later.');
}
function recordFailure(ip: string) {
  const r = loginFailures.get(ip);
  const until = Date.now() + 10 * 60_000;
  if (!r || r.until < Date.now()) loginFailures.set(ip, { count: 1, until });
  else loginFailures.set(ip, { count: r.count + 1, until });
  if (loginFailures.size > 10_000) loginFailures.clear();
}

/** Request headers the browser may forward to the AI provider through the proxy. */
const FORWARDED_HEADERS = [
  'content-type',
  'accept',
  'anthropic-version',
  'anthropic-beta',
  'openai-organization',
  'openai-project',
  'http-referer',
  'x-title',
];

export function createApp(opts: AppOptions) {
  const app = new Hono<AppEnv>();
  const sessionMs = (opts.sessionDays ?? 30) * 86_400_000;
  const upstreamFetch = opts.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const clientIp = (c: Context) =>
    opts.getClientIp?.(c) ||
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'unknown';

  // HSTS is left to the TLS-terminating proxy: on a shared domain it could break other subdomains.
  app.use('*', secureHeaders({ strictTransportSecurity: false }));

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    console.error('[omnichat]', err);
    return c.json({ error: 'Internal server error' }, 500);
  });

  app.use('/api/*', async (c, next) => {
    const db = opts.getDb(c);
    await ensureSchema(db);
    c.set('db', db);
    await next();
  });

  async function getConfig(db: DB, key: string): Promise<string | null> {
    const row = await db.first<{ value: string }>('SELECT value FROM app_config WHERE key = ?', [key]);
    return row?.value ?? null;
  }
  async function setConfig(db: DB, key: string, value: string) {
    await db.run(
      'INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value],
    );
  }
  async function allowRegister(c: Context<AppEnv>): Promise<boolean> {
    const v = await getConfig(c.get('db'), 'allow_register');
    return v === null ? opts.defaultAllowRegister(c) : v === '1';
  }
  let dbSecret: Promise<string> | null = null;
  async function getSecret(c: Context<AppEnv>, db: DB): Promise<string> {
    const s = opts.getSecret?.(c);
    if (s) return s;
    if (!dbSecret) {
      dbSecret = (async () => {
        const existing = await getConfig(db, 'secret_key');
        if (existing) return existing;
        const created = randomToken(32);
        await db.run('INSERT OR IGNORE INTO app_config (key, value) VALUES (?, ?)', ['secret_key', created]);
        return (await getConfig(db, 'secret_key')) ?? created;
      })().catch((err) => {
        dbSecret = null;
        throw err;
      });
    }
    return dbSecret;
  }
  async function hasUsers(db: DB) {
    return !!(await db.first('SELECT id FROM users LIMIT 1'));
  }

  async function createSession(c: Context<AppEnv>, user: UserRow) {
    const db = c.get('db');
    const token = randomToken();
    const t = Date.now();
    await db.run(
      'INSERT INTO sessions (id, token_hash, user_id, user_agent, ip, created_at, last_seen, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [randomId(), await sha256Hex(token), user.id, (c.req.header('user-agent') ?? '').slice(0, 300), clientIp(c), t, t, t + sessionMs],
    );
    // Opportunistic cleanup of expired sessions.
    await db.run('DELETE FROM sessions WHERE expires_at < ?', [t]);
    return token;
  }

  function validateCredentials(username: unknown, password: unknown) {
    if (typeof username !== 'string' || !/^[\p{L}\p{N}_.@-]{2,32}$/u.test(username))
      fail(400, 'Username must be 2-32 characters: letters, digits, _ . @ -');
    if (typeof password !== 'string' || password.length < 6 || password.length > 200)
      fail(400, 'Password must be at least 6 characters');
    return { username: username as string, password: password as string };
  }

  // ---------- Public endpoints ----------

  app.get('/api/health', (c) => c.json({ ok: true, version: APP_VERSION }));

  app.get('/api/auth/status', async (c) => {
    const db = c.get('db');
    const status: AuthStatus = {
      hasUsers: await hasUsers(db),
      allowRegister: await allowRegister(c),
      version: APP_VERSION,
      limits: opts.limits(c),
    };
    return c.json(status);
  });

  app.post('/api/auth/register', async (c) => {
    const db = c.get('db');
    const body = await c.req.json().catch(() => ({}));
    const { username, password } = validateCredentials(body.username, body.password);
    const first = !(await hasUsers(db));
    if (!first && !(await allowRegister(c))) fail(403, 'Registration is disabled');
    if (await db.first('SELECT id FROM users WHERE username = ?', [username])) fail(409, 'Username already exists');
    const user: UserRow = {
      id: randomId(),
      username,
      password_hash: await hashPassword(password, opts.passwordIterations(c)),
      is_admin: first ? 1 : 0,
      created_at: Date.now(),
    };
    await db.run('INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?)', [
      user.id,
      user.username,
      user.password_hash,
      user.is_admin,
      user.created_at,
    ]);
    // The first account is the admin. Close registration by default once it exists.
    if (first && (await getConfig(db, 'allow_register')) === null) {
      await setConfig(db, 'allow_register', opts.defaultAllowRegister(c) ? '1' : '0');
    }
    return c.json({ token: await createSession(c, user), user: publicUser(user) });
  });

  app.post('/api/auth/login', async (c) => {
    const db = c.get('db');
    const ip = clientIp(c);
    checkThrottle(ip);
    const body = await c.req.json().catch(() => ({}));
    const username = String(body.username ?? '');
    const password = String(body.password ?? '');
    const user = await db.first<UserRow>('SELECT * FROM users WHERE username = ?', [username]);
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      recordFailure(ip);
      fail(401, 'Invalid username or password');
    }
    loginFailures.delete(ip);
    return c.json({ token: await createSession(c, user), user: publicUser(user) });
  });

  // ---------- Authentication middleware ----------

  app.use('/api/*', async (c, next) => {
    const path = c.req.path;
    if (path === '/api/health' || path.startsWith('/api/auth/status') || path === '/api/auth/login' || path === '/api/auth/register')
      return next();
    const auth = c.req.header('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token) fail(401, 'Not signed in');
    const db = c.get('db');
    const row = await db.first<UserRow & { session_id: string; expires_at: number; last_seen: number }>(
      `SELECT u.*, s.id AS session_id, s.expires_at, s.last_seen FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
      [await sha256Hex(token)],
    );
    const t = Date.now();
    if (!row || row.expires_at < t) fail(401, 'Session expired');
    if (t - row.last_seen > 5 * 60_000) {
      await db.run('UPDATE sessions SET last_seen = ?, expires_at = ?, ip = ? WHERE id = ?', [t, t + sessionMs, clientIp(c), row.session_id]);
    }
    c.set('user', row);
    c.set('sessionId', row.session_id);
    await next();
  });

  // ---------- Account ----------

  app.get('/api/auth/me', (c) => c.json({ user: publicUser(c.get('user')) }));

  app.post('/api/auth/logout', async (c) => {
    await c.get('db').run('DELETE FROM sessions WHERE id = ?', [c.get('sessionId')]);
    return c.json({ ok: true });
  });

  app.post('/api/auth/password', async (c) => {
    const db = c.get('db');
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    if (!(await verifyPassword(String(body.oldPassword ?? ''), user.password_hash))) fail(400, 'Current password is incorrect');
    const { password } = validateCredentials(user.username, body.newPassword);
    await db.batch([
      { sql: 'UPDATE users SET password_hash = ? WHERE id = ?', params: [await hashPassword(password, opts.passwordIterations(c)), user.id] },
      { sql: 'DELETE FROM sessions WHERE user_id = ? AND id != ?', params: [user.id, c.get('sessionId')] },
    ]);
    return c.json({ ok: true });
  });

  app.get('/api/auth/sessions', async (c) => {
    const rows = await c
      .get('db')
      .all<{ id: string; user_agent: string; ip: string; created_at: number; last_seen: number }>(
        'SELECT id, user_agent, ip, created_at, last_seen FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen DESC',
        [c.get('user').id, Date.now()],
      );
    return c.json({
      sessions: rows.map((r) => ({
        id: r.id,
        userAgent: r.user_agent,
        ip: r.ip,
        createdAt: r.created_at,
        lastSeen: r.last_seen,
        current: r.id === c.get('sessionId'),
      })),
    });
  });

  app.delete('/api/auth/sessions/:id', async (c) => {
    await c.get('db').run('DELETE FROM sessions WHERE id = ? AND user_id = ?', [c.req.param('id'), c.get('user').id]);
    return c.json({ ok: true });
  });

  // ---------- Admin ----------

  app.use('/api/admin/*', async (c, next) => {
    if (!c.get('user').is_admin) fail(403, 'Admin only');
    await next();
  });

  app.get('/api/admin/config', async (c) => c.json({ allowRegister: await allowRegister(c) }));

  app.put('/api/admin/config', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (typeof body.allowRegister === 'boolean') await setConfig(c.get('db'), 'allow_register', body.allowRegister ? '1' : '0');
    return c.json({ allowRegister: await allowRegister(c) });
  });

  app.get('/api/admin/users', async (c) => {
    const rows = await c.get('db').all<UserRow & { conversations: number }>(
      `SELECT u.*, (SELECT COUNT(*) FROM entities e WHERE e.user_id = u.id AND e.kind = 'conversation' AND e.deleted = 0) AS conversations
       FROM users u ORDER BY u.created_at`,
    );
    return c.json({ users: rows.map((r) => ({ ...publicUser(r), conversations: r.conversations })) });
  });

  app.post('/api/admin/users/:id/password', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const id = c.req.param('id');
    const db = c.get('db');
    const target = await db.first<UserRow>('SELECT * FROM users WHERE id = ?', [id]);
    if (!target) fail(404, 'User not found');
    const { password } = validateCredentials(target.username, body.password);
    await db.batch([
      { sql: 'UPDATE users SET password_hash = ? WHERE id = ?', params: [await hashPassword(password, opts.passwordIterations(c)), id] },
      // Sign the user out everywhere (except this very session, when admins reset their own password).
      { sql: 'DELETE FROM sessions WHERE user_id = ? AND id != ?', params: [id, c.get('sessionId')] },
    ]);
    return c.json({ ok: true });
  });

  app.delete('/api/admin/users/:id', async (c) => {
    const id = c.req.param('id');
    if (id === c.get('user').id) fail(400, 'You cannot delete yourself');
    await c.get('db').batch(
      ['users WHERE id', 'sessions WHERE user_id', 'entities WHERE user_id', 'messages WHERE user_id', 'secrets WHERE user_id'].map(
        (t) => ({ sql: `DELETE FROM ${t} = ?`, params: [id] }),
      ),
    );
    return c.json({ ok: true });
  });

  // ---------- Sync ----------

  app.get('/api/sync', async (c) => {
    const since = Number(c.req.query('since') ?? 0) || 0;
    const t = now();
    const rows = await c
      .get('db')
      .all<{ kind: EntityKind; id: string; data: string; updated_at: number; deleted: number }>(
        `SELECT kind, id, data, updated_at, deleted FROM entities
         WHERE user_id = ? AND updated_at > ? AND (deleted = 0 OR ? > 0) ORDER BY updated_at`,
        [c.get('user').id, since, since],
      );
    return c.json({
      now: t,
      entities: rows.map((r) => ({
        kind: r.kind,
        id: r.id,
        data: parseJson(r.data, {}),
        updatedAt: r.updated_at,
        deleted: !!r.deleted,
      })),
    });
  });

  app.get('/api/messages', async (c) => {
    const conversationId = c.req.query('conversationId') ?? '';
    const since = Number(c.req.query('since') ?? 0) || 0;
    const t = now();
    const rows = await c
      .get('db')
      .all<{ id: string; conversation_id: string; data: string; updated_at: number; deleted: number }>(
        `SELECT id, conversation_id, data, updated_at, deleted FROM messages
         WHERE user_id = ? AND conversation_id = ? AND updated_at > ? AND (deleted = 0 OR ? > 0) ORDER BY created_at`,
        [c.get('user').id, conversationId, since, since],
      );
    return c.json({
      now: t,
      messages: rows.map((r) => ({
        id: r.id,
        conversationId: r.conversation_id,
        data: parseJson(r.data, {}),
        updatedAt: r.updated_at,
        deleted: !!r.deleted,
      })),
    });
  });

  /** Runs `SELECT … WHERE user_id = ? AND id IN (…)` in chunks (D1 allows 100 bound parameters). */
  async function selectIn<T>(db: DB, sqlPrefix: string, userId: string, ids: string[]): Promise<T[]> {
    const out: T[] = [];
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90);
      out.push(...(await db.all<T>(`${sqlPrefix} (${chunk.map(() => '?').join(',')})`, [userId, ...chunk])));
    }
    return out;
  }

  // All writes of a push go into one transactional batch: a constant number of round trips
  // regardless of size, which keeps Cloudflare D1 within its per-request query limits.
  app.post('/api/sync/push', bodyLimit({ maxSize: 64 * 1024 * 1024, onError: () => fail(413, 'Payload too large') }), async (c) => {
    const db = c.get('db');
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    const ops: PushOp[] = Array.isArray(body?.ops) ? body.ops : fail(400, 'ops must be an array');
    const limits = opts.limits(c);
    if (ops.length > limits.maxOps) fail(400, `Too many operations in one push (max ${limits.maxOps})`);

    const encoded = new Map<PushOp, string>();
    for (const op of ops) {
      if (!op || typeof op.id !== 'string' || !op.id || op.id.length > 100) fail(400, 'Invalid operation id');
      if (op.kind !== 'message' && !ENTITY_KINDS.includes(op.kind)) fail(400, `Unknown kind: ${String(op.kind)}`);
      if (op.deleted) continue;
      if (op.data !== undefined && (typeof op.data !== 'object' || op.data === null || Array.isArray(op.data))) fail(400, 'Invalid data');
      const json = JSON.stringify(op.data ?? {});
      if (json.length > limits.maxRecordBytes) {
        fail(413, `Item too large to sync (${(json.length / 1048576).toFixed(1)} MB; limit ${(limits.maxRecordBytes / 1048576).toFixed(1)} MB)`);
      }
      encoded.set(op, json);
    }

    const deletedMessageIds = ops.filter((o) => o.kind === 'message' && o.deleted).map((o) => o.id);
    const prevMessages = new Map(
      (
        await selectIn<{ id: string; conversation_id: string }>(db, 'SELECT id, conversation_id FROM messages WHERE user_id = ? AND id IN', user.id, deletedMessageIds)
      ).map((r) => [r.id, r.conversation_id]),
    );
    // Current rows of the touched entities (and of the conversations new messages belong to):
    // needed to merge patches, keep provider keys, and avoid resurrecting records deleted elsewhere.
    const lookupIds = new Set<string>();
    for (const o of ops) {
      if (o.kind !== 'message') lookupIds.add(o.id);
      else if (!o.deleted && typeof (o.data as { conversationId?: unknown })?.conversationId === 'string') {
        lookupIds.add((o.data as { conversationId: string }).conversationId);
      }
    }
    const existing = new Map(
      (
        await selectIn<{ kind: string; id: string; data: string; deleted: number }>(
          db,
          'SELECT kind, id, data, deleted FROM entities WHERE user_id = ? AND id IN',
          user.id,
          [...lookupIds],
        )
      ).map((r) => [`${r.kind}:${r.id}`, r]),
    );

    const secret = await getSecret(c, db);
    const stmts: Statement[] = [];
    const results: { kind: string; id: string; updatedAt: number }[] = [];
    const touched = new Set<string>();
    const deletedConversations = new Set<string>();

    for (const op of ops) {
      const t = now();
      if (op.kind === 'message') {
        if (op.deleted) {
          const convId = prevMessages.get(op.id);
          if (convId) {
            stmts.push({ sql: "UPDATE messages SET deleted = 1, data = '{}', updated_at = ? WHERE user_id = ? AND id = ?", params: [t, user.id, op.id] });
            touched.add(convId);
          }
        } else {
          const data = (op.data ?? {}) as { conversationId?: string; createdAt?: number };
          if (typeof data.conversationId !== 'string') fail(400, 'Message requires conversationId');
          // Don't attach messages to a conversation that another device deleted.
          if (existing.get(`conversation:${data.conversationId}`)?.deleted) {
            results.push({ kind: 'message', id: op.id, updatedAt: t });
            continue;
          }
          stmts.push({
            sql: `INSERT INTO messages (user_id, id, conversation_id, data, created_at, updated_at, deleted) VALUES (?, ?, ?, ?, ?, ?, 0)
                  ON CONFLICT(user_id, id) DO UPDATE SET conversation_id = excluded.conversation_id, data = excluded.data,
                  created_at = excluded.created_at, updated_at = excluded.updated_at, deleted = 0`,
            params: [user.id, op.id, data.conversationId, encoded.get(op)!, Number(data.createdAt) || t, t],
          });
          touched.add(data.conversationId);
        }
        results.push({ kind: 'message', id: op.id, updatedAt: t });
        continue;
      }

      const key = `${op.kind}:${op.id}`;
      const prev = existing.get(key);
      let json = op.deleted ? '{}' : encoded.get(op)!;
      if (!op.deleted && op.patch) {
        if (prev?.deleted) {
          // A partial update must not bring back a record deleted on another device.
          results.push({ kind: op.kind, id: op.id, updatedAt: t });
          continue;
        }
        const merged: Record<string, unknown> = prev ? parseJson<Record<string, unknown>>(prev.data, {}) : {};
        for (const [k, v] of Object.entries((op.data ?? {}) as Record<string, unknown>)) {
          if (v === null) delete merged[k];
          else merged[k] = v;
        }
        json = JSON.stringify(merged);
        if (json.length > limits.maxRecordBytes) fail(413, 'Item too large to sync');
      }
      if (op.kind === 'provider') {
        if (op.deleted) {
          stmts.push({ sql: 'DELETE FROM secrets WHERE user_id = ? AND provider_id = ?', params: [user.id, op.id] });
        } else {
          const prevData = prev && !prev.deleted ? parseJson<ProviderData | null>(prev.data, null) : null;
          const prepared = await prepareProvider(user, op.id, JSON.parse(json) as ProviderData, prevData, secret, stmts, t);
          json = JSON.stringify(prepared);
        }
      }
      existing.set(key, { kind: op.kind, id: op.id, data: json, deleted: op.deleted ? 1 : 0 });
      if (op.kind === 'conversation' && op.deleted) {
        stmts.push({ sql: 'DELETE FROM messages WHERE user_id = ? AND conversation_id = ?', params: [user.id, op.id] });
        deletedConversations.add(op.id);
      }
      stmts.push({
        sql: `INSERT INTO entities (user_id, kind, id, data, updated_at, deleted) VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(user_id, kind, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted`,
        params: [user.id, op.kind, op.id, json, t, op.deleted ? 1 : 0],
      });
      if (op.kind === 'conversation') touched.delete(op.id);
      results.push({ kind: op.kind, id: op.id, updatedAt: t });
    }

    // Bump conversations whose messages changed so other devices know to refetch them.
    for (const convId of touched) {
      if (deletedConversations.has(convId)) continue;
      stmts.push({
        sql: "UPDATE entities SET updated_at = ? WHERE user_id = ? AND kind = 'conversation' AND id = ? AND deleted = 0",
        params: [now(), user.id, convId],
      });
    }
    await db.batch(stmts);
    return c.json({ now: now(), results });
  });

  /** Moves the write-only apiKey field into the encrypted secrets table. */
  async function prepareProvider(
    user: UserRow,
    id: string,
    data: ProviderData,
    prev: ProviderData | null,
    secret: string,
    stmts: Statement[],
    t: number,
  ): Promise<ProviderData> {
    const out: ProviderData = { ...data };
    if (typeof out.baseUrl === 'string' && out.baseUrl) {
      let url: URL;
      try {
        url = new URL(out.baseUrl);
      } catch {
        fail(400, 'Invalid base URL');
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') fail(400, 'Base URL must be http(s)');
    }
    if ('apiKey' in out) {
      const key = String(out.apiKey ?? '').trim();
      delete out.apiKey;
      if (key) {
        stmts.push({
          sql: `INSERT INTO secrets (user_id, provider_id, value, updated_at) VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id, provider_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
          params: [user.id, id, await encryptSecret(key, secret), t],
        });
        out.hasKey = true;
        out.keyHint = maskKey(key);
      } else {
        stmts.push({ sql: 'DELETE FROM secrets WHERE user_id = ? AND provider_id = ?', params: [user.id, id] });
        out.hasKey = false;
        delete out.keyHint;
      }
    } else {
      out.hasKey = !!prev?.hasKey;
      if (prev?.keyHint) out.keyHint = prev.keyHint;
      else delete out.keyHint;
    }
    return out;
  }

  async function loadProvider(c: Context<AppEnv>, id: string) {
    const db = c.get('db');
    const user = c.get('user');
    const row = await db.first<{ data: string }>(
      "SELECT data FROM entities WHERE user_id = ? AND kind = 'provider' AND id = ? AND deleted = 0",
      [user.id, id],
    );
    if (!row) fail(404, 'Provider not found');
    const provider = parseJson<ProviderData>(row.data, {} as ProviderData);
    const s = await db.first<{ value: string }>('SELECT value FROM secrets WHERE user_id = ? AND provider_id = ?', [user.id, id]);
    const key = s ? await decryptSecret(s.value, await getSecret(c, db)) : null;
    return { provider, key };
  }

  // Direct (browser → provider) mode needs the key on the client.
  app.get('/api/providers/:id/key', async (c) => {
    const { key } = await loadProvider(c, c.req.param('id'));
    return c.json({ apiKey: key ?? '' });
  });

  // ---------- AI proxy ----------

  app.all('/api/proxy/:pid/*', bodyLimit({ maxSize: 64 * 1024 * 1024, onError: () => fail(413, 'Payload too large') }), async (c) => {
    const pid = c.req.param('pid');
    const { provider, key } = await loadProvider(c, pid);
    if (!provider.baseUrl) fail(400, 'Provider has no base URL');

    const url = new URL(c.req.url);
    const prefix = `/api/proxy/${encodeURIComponent(pid)}`;
    const idx = url.pathname.indexOf(prefix);
    const rest = idx >= 0 ? url.pathname.slice(idx + prefix.length) : '/';
    const target = new URL(joinUrl(provider.baseUrl, rest || '/') + url.search);
    if (target.protocol !== 'http:' && target.protocol !== 'https:') fail(400, 'Unsupported protocol');
    if (!c.get('user').is_admin && !opts.allowPrivateNetwork(c) && isPrivateHost(target.hostname)) {
      fail(403, 'Private network addresses are not allowed. Use direct (browser) mode for local models.');
    }

    const headers = new Headers();
    for (const name of FORWARDED_HEADERS) {
      const v = c.req.header(name);
      if (v) headers.set(name, v);
    }
    if (provider.type === 'anthropic' && !headers.has('anthropic-version')) headers.set('anthropic-version', ANTHROPIC_DEFAULT_VERSION);
    for (const [k, v] of Object.entries(provider.headers ?? {})) {
      if (k && typeof v === 'string') headers.set(k, v);
    }
    applyAuth(headers, provider, key);

    const method = c.req.method.toUpperCase();
    const body = method === 'GET' || method === 'HEAD' ? undefined : await c.req.arrayBuffer();

    let upstream: Response;
    try {
      upstream = await upstreamFetch(target.toString(), { method, headers, body, signal: c.req.raw.signal, redirect: 'follow' });
    } catch (err) {
      if (c.req.raw.signal.aborted) return new Response(null, { status: 499 });
      const msg = err instanceof Error ? `${err.message}${err.cause ? ` (${String((err.cause as Error).message ?? err.cause)})` : ''}` : String(err);
      fail(502, `Failed to reach ${target.host}: ${msg}`);
    }

    const out = new Headers();
    const ct = upstream.headers.get('content-type');
    if (ct) out.set('content-type', ct);
    for (const h of ['retry-after', 'x-request-id', 'request-id']) {
      const v = upstream.headers.get(h);
      if (v) out.set(h, v);
    }
    out.set('cache-control', 'no-cache, no-transform');
    out.set('x-accel-buffering', 'no');
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
  });

  // ---------- Usage statistics ----------

  // Tokens per model per local day. Every generated version counts (multi-model and regenerated answers cost too).
  app.get('/api/stats', async (c) => {
    const days = Math.min(366, Math.max(1, Math.round(Number(c.req.query('days')) || 30)));
    const tzOffsetMs = Math.round(Number(c.req.query('tzOffset')) || 0) * 60_000;
    const since = Date.now() - days * 86_400_000;
    const rows = await c.get('db').all<{ model: string | null; provider: string | null; day: number; requests: number; input: number; output: number }>(
      `SELECT json_extract(v.value, '$.model') AS model,
              json_extract(v.value, '$.providerName') AS provider,
              CAST((m.created_at - ?) / 86400000 AS INTEGER) AS day,
              COUNT(*) AS requests,
              SUM(COALESCE(json_extract(v.value, '$.usage.input'), 0)) AS input,
              SUM(COALESCE(json_extract(v.value, '$.usage.output'), 0)) AS output
       FROM messages m,
            json_each(CASE WHEN json_type(m.data, '$.versions') = 'array' THEN json_extract(m.data, '$.versions') ELSE json_array(json(m.data)) END) v
       WHERE m.user_id = ? AND m.deleted = 0 AND m.created_at >= ? AND json_extract(m.data, '$.role') = 'assistant'
         AND COALESCE(json_extract(v.value, '$.status'), 'done') != 'streaming'
       GROUP BY model, provider, day`,
      [tzOffsetMs, c.get('user').id, since],
    );
    return c.json({ days, rows });
  });

  // ---------- Search ----------

  app.get('/api/search', async (c) => {
    const q = (c.req.query('q') ?? '').trim().slice(0, 100);
    if (q.length < 2) return c.json({ results: [] });
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const rows = await c.get('db').all<{ conversation_id: string; id: string; data: string }>(
      `SELECT conversation_id, id, data FROM messages WHERE user_id = ? AND deleted = 0 AND data LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT 300`,
      [c.get('user').id, like],
    );
    const lower = q.toLowerCase();
    const seen = new Set<string>();
    const results: { conversationId: string; messageId: string; snippet: string }[] = [];
    for (const r of rows) {
      if (seen.has(r.conversation_id)) continue;
      const content = String(parseJson<{ content?: string }>(r.data, {}).content ?? '');
      const idx = content.toLowerCase().indexOf(lower);
      if (idx < 0) continue;
      seen.add(r.conversation_id);
      const start = Math.max(0, idx - 30);
      const snippet = `${start > 0 ? '…' : ''}${content.slice(start, idx + q.length + 70).replace(/\s+/g, ' ')}`;
      results.push({ conversationId: r.conversation_id, messageId: r.id, snippet });
      if (results.length >= 30) break;
    }
    return c.json({ results });
  });

  // ---------- Export ----------

  app.get('/api/export', async (c) => {
    const db = c.get('db');
    const user = c.get('user');
    const includeKeys = c.req.query('includeKeys') === '1';
    const entities = await db.all<{ kind: string; id: string; data: string }>(
      'SELECT kind, id, data FROM entities WHERE user_id = ? AND deleted = 0',
      [user.id],
    );
    const messages = await db.all<{ id: string; conversation_id: string; data: string }>(
      'SELECT id, conversation_id, data FROM messages WHERE user_id = ? AND deleted = 0 ORDER BY created_at',
      [user.id],
    );
    let keys: Record<string, string> | undefined;
    if (includeKeys) {
      keys = {};
      const secret = await getSecret(c, db);
      for (const s of await db.all<{ provider_id: string; value: string }>('SELECT provider_id, value FROM secrets WHERE user_id = ?', [
        user.id,
      ])) {
        keys[s.provider_id] = await decryptSecret(s.value, secret);
      }
    }
    return c.json({
      app: 'omnichat',
      version: 1,
      exportedAt: Date.now(),
      entities: entities.map((e) => ({ kind: e.kind, id: e.id, data: parseJson(e.data, {}) })),
      messages: messages.map((m) => ({ id: m.id, conversationId: m.conversation_id, data: parseJson(m.data, {}) })),
      keys,
    });
  });

  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

  return app;
}
