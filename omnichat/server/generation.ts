// Background generation (self-hosted Node): the server streams replies itself and saves them, so a reply finishes even
// when every page is closed. Open pages follow a running reply over server-sent events and can re-attach at any time;
// the reply is also saved every few seconds, so other devices see its progress through normal sync.
import type { Context, Hono } from 'hono';
import type { AppEnv } from './app';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import type { DB, Statement } from './db';
import { now } from './clock';
import type { GenerateRequest, JobEvents, JobSnapshot } from '../src/lib/ai/background';
import type { RunReplyOptions } from '../src/lib/ai/reply';
import type { SearchFn } from '../src/lib/ai/tool-loop';
import type { ChatRequest, ChatResult, ProviderFetcher } from '../src/lib/ai/transport';
import type { Message, MessageVersion, Provider } from '../src/lib/types';

/** The protocol code shared with the browser (src/lib/ai), injected so deployments without background jobs skip it. */
export interface GenerationEngine {
  runReply(o: RunReplyOptions): Promise<MessageVersion>;
  streamChat(req: ChatRequest): Promise<ChatResult>;
  composeMessage(job: JobSnapshot, versionIndex?: number): Message;
  titlePrompt(user: string, reply: string): string;
  cleanTitle(s: string): string;
}

export interface GenerationDeps {
  engine: GenerationEngine;
  /** A provider of the signed-in user with a transport that sends its requests (key attached) upstream. */
  providerFor(c: Context<AppEnv>, providerId: string): Promise<{ provider: Provider; fetch: ProviderFetcher }>;
  /** Searches through the account's search service; throws when none is usable. */
  searchFor(c: Context<AppEnv>): Promise<SearchFn>;
}

type Listener = { send<K extends keyof JobEvents>(event: K, data: JobEvents[K]): void; close(): void };

interface Job {
  userId: string;
  snapshot: JobSnapshot;
  controller: AbortController;
  listeners: Set<Listener>;
  /** Drop the reply instead of saving it (the message is being deleted). */
  discard: boolean;
  /** Changed since the last periodic save. */
  dirty: boolean;
}

const MAX_TARGETS = 6;
const SAVE_EVERY_MS = 4000;
const PING_EVERY_MS = 15_000;
const INTERRUPTED = 'Interrupted: the server restarted before this reply finished.';

const jobs = new Map<string, Job>();
const jobKey = (userId: string, conversationId: string) => `${userId}:${conversationId}`;

function fail(status: 400 | 404 | 409 | 413, message: string): never {
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

function emit<K extends keyof JobEvents>(job: Job, event: K, data: JobEvents[K]) {
  for (const l of job.listeners) l.send(event, data);
}

/**
 * Saves a message the way a sync push does and bumps its conversation so other devices refetch.
 * Returns the row's new updated_at, or 0 when the chat or the message was deleted meanwhile.
 */
async function writeMessage(db: DB, userId: string, msg: Message, conversationPatch?: Record<string, unknown>): Promise<number> {
  const conv = await db.first<{ data: string; deleted: number }>(
    "SELECT data, deleted FROM entities WHERE user_id = ? AND kind = 'conversation' AND id = ?",
    [userId, msg.conversationId],
  );
  if (conv?.deleted) return 0;
  const row = await db.first<{ deleted: number }>('SELECT deleted FROM messages WHERE user_id = ? AND id = ?', [userId, msg.id]);
  if (row?.deleted) return 0;
  const { syncedAt: _s, ...data } = msg;
  const t = now();
  const stmts: Statement[] = [
    {
      sql: `INSERT INTO messages (user_id, id, conversation_id, data, created_at, updated_at, deleted) VALUES (?, ?, ?, ?, ?, ?, 0)
            ON CONFLICT(user_id, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      params: [userId, msg.id, msg.conversationId, JSON.stringify(data), msg.createdAt, t],
    },
  ];
  if (conv && conversationPatch) {
    const merged = { ...parseJson<Record<string, unknown>>(conv.data, {}), ...conversationPatch };
    stmts.push({
      sql: "UPDATE entities SET data = ?, updated_at = ? WHERE user_id = ? AND kind = 'conversation' AND id = ? AND deleted = 0",
      params: [JSON.stringify(merged), now(), userId, msg.conversationId],
    });
  } else {
    stmts.push({
      sql: "UPDATE entities SET updated_at = ? WHERE user_id = ? AND kind = 'conversation' AND id = ? AND deleted = 0",
      params: [now(), userId, msg.conversationId],
    });
  }
  await db.batch(stmts);
  return t;
}

async function deleteMessage(db: DB, userId: string, conversationId: string, id: string) {
  await db.batch([
    { sql: "UPDATE messages SET deleted = 1, data = '{}', updated_at = ? WHERE user_id = ? AND id = ?", params: [now(), userId, id] },
    {
      sql: "UPDATE entities SET updated_at = ? WHERE user_id = ? AND kind = 'conversation' AND id = ? AND deleted = 0",
      params: [now(), userId, conversationId],
    },
  ]);
}

/** A version still marked as streaming becomes an error that says the reply was cut off. */
function markInterrupted<T extends MessageVersion>(v: T): T {
  return v.status === 'streaming' ? { ...v, status: 'error', error: INTERRUPTED, errorCode: 'interrupted', searching: undefined } : v;
}

/**
 * Replies that were running when the server stopped stay saved as "streaming": mark them as interrupted.
 * Call once at startup, before serving requests.
 */
export async function recoverInterruptedReplies(db: DB) {
  const rows = await db.all<{ user_id: string; message_id: string; conversation_id: string }>('SELECT user_id, message_id, conversation_id FROM jobs');
  for (const r of rows) {
    const row = await db.first<{ data: string; deleted: number }>('SELECT data, deleted FROM messages WHERE user_id = ? AND id = ?', [r.user_id, r.message_id]);
    const msg = row && !row.deleted ? parseJson<Message | null>(row.data, null) : null;
    if (msg) {
      const fixed: Message = { ...markInterrupted(msg), versions: msg.versions?.map(markInterrupted) };
      if (!fixed.versions) delete fixed.versions;
      await writeMessage(db, r.user_id, { ...fixed, id: r.message_id, conversationId: r.conversation_id });
    }
    await db.run('DELETE FROM jobs WHERE user_id = ? AND message_id = ?', [r.user_id, r.message_id]);
  }
  if (rows.length) console.log(`[omnichat] marked ${rows.length} interrupted repl${rows.length === 1 ? 'y' : 'ies'}`);
}

/** A server-sent event stream of a job, starting with its current state. Closing the page does not stop the job. */
function eventStream(job: Job, signal: AbortSignal): Response {
  const enc = new TextEncoder();
  let listener: Listener | null = null;
  let ping: ReturnType<typeof setInterval> | null = null;
  const cleanup = () => {
    if (ping) clearInterval(ping);
    ping = null;
    if (listener) job.listeners.delete(listener);
    listener = null;
  };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (s: string) => {
        try {
          controller.enqueue(enc.encode(s));
        } catch {
          cleanup();
        }
      };
      listener = {
        send: (event, data) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        close: () => {
          cleanup();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        },
      };
      listener.send('init', job.snapshot);
      job.listeners.add(listener);
      // Comments keep proxies from closing the connection while a reasoning model is silent.
      ping = setInterval(() => write(': ping\n\n'), PING_EVERY_MS);
      signal.addEventListener('abort', cleanup, { once: true });
    },
    cancel: cleanup,
  });
  return new Response(body, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' },
  });
}

function validRequest(b: unknown): GenerateRequest {
  const r = b as GenerateRequest;
  const id = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 100;
  if (!r || typeof r !== 'object') fail(400, 'Invalid request');
  if (!id(r.conversationId) || !id(r.messageId)) fail(400, 'Invalid conversation or message id');
  if (typeof r.createdAt !== 'number' || !Number.isFinite(r.createdAt)) fail(400, 'Invalid createdAt');
  if (!Array.isArray(r.targets) || !r.targets.length || r.targets.length > MAX_TARGETS) fail(400, `Between 1 and ${MAX_TARGETS} models`);
  for (const t of r.targets) if (!t || !id(t.providerId) || typeof t.model !== 'string' || !t.model) fail(400, 'Invalid model');
  if (!Array.isArray(r.messages)) fail(400, 'messages must be an array');
  if (r.prior !== undefined && !Array.isArray(r.prior)) fail(400, 'prior must be an array');
  if (r.params !== undefined && (typeof r.params !== 'object' || r.params === null)) fail(400, 'Invalid params');
  return { ...r, params: r.params ?? {}, prior: r.prior ?? [], emptyText: typeof r.emptyText === 'string' ? r.emptyText : 'Empty response' };
}

export function registerGeneration(app: Hono<AppEnv>, deps: GenerationDeps) {
  const { engine } = deps;

  /** Names a new chat after its first reply, unless it already has a generated title. */
  async function nameChat(db: DB, userId: string, req: GenerateRequest, reply: string, model: { provider: Provider; fetch: ProviderFetcher; model: string }) {
    const first = req.messages.find((m) => m.role === 'user');
    const userText = first?.content || first?.attachments?.map((a) => a.name).join(', ') || '';
    const earlier = req.messages.find((m) => m.role === 'assistant' && m.content)?.content;
    if (!userText) return null;
    let out = '';
    try {
      await engine.streamChat({
        provider: model.provider,
        model: model.model,
        messages: [{ role: 'user', content: engine.titlePrompt(userText, earlier ?? reply) }],
        params: { reasoningEffort: 'default' },
        signal: AbortSignal.timeout(90_000),
        sessionId: req.conversationId,
        fetch: model.fetch,
        onDelta: (d) => {
          out += d.content ?? '';
        },
      });
    } catch {
      return null;
    }
    const title = engine.cleanTitle(out);
    if (!title) return null;
    const conv = await db.first<{ data: string; deleted: number }>(
      "SELECT data, deleted FROM entities WHERE user_id = ? AND kind = 'conversation' AND id = ?",
      [userId, req.conversationId],
    );
    if (!conv || conv.deleted) return null;
    const data = parseJson<Record<string, unknown>>(conv.data, {});
    if (data.titleGenerated) return null;
    await db.run("UPDATE entities SET data = ?, updated_at = ? WHERE user_id = ? AND kind = 'conversation' AND id = ? AND deleted = 0", [
      JSON.stringify({ ...data, title, titleGenerated: true }),
      now(),
      userId,
      req.conversationId,
    ]);
    return title;
  }

  async function run(
    db: DB,
    job: Job,
    req: GenerateRequest,
    targets: { provider: Provider; fetch: ProviderFetcher; search?: SearchFn }[],
    titleModel: { provider: Provider; fetch: ProviderFetcher; model: string } | null,
  ) {
    const { userId } = job;
    const key = jobKey(userId, req.conversationId);
    let saving: Promise<unknown> = Promise.resolve();
    const save = () => {
      saving = saving
        .then(async () => {
          if (job.discard || job.controller.signal.aborted) return;
          // Deleted on another device: stop generating.
          if (!(await writeMessage(db, userId, engine.composeMessage(job.snapshot)))) job.controller.abort();
        })
        .catch((err) => console.error('[omnichat] saving a reply failed', err));
      return saving;
    };
    const timer = setInterval(() => {
      if (!job.dirty) return;
      job.dirty = false;
      void save();
    }, SAVE_EVERY_MS);

    let message: Message | null = null;
    let updatedAt = 0;
    try {
      await db.run('INSERT OR REPLACE INTO jobs (user_id, message_id, conversation_id, started_at) VALUES (?, ?, ?, ?)', [
        userId,
        req.messageId,
        req.conversationId,
        Date.now(),
      ]);
      await save();
      await Promise.all(
        targets.map((t, i) =>
          engine
            .runReply({
              target: { provider: t.provider, model: req.targets[i].model },
              request: { system: req.targets[i].system, messages: req.messages, params: { ...req.params }, sessionId: req.conversationId, fetch: t.fetch },
              signal: job.controller.signal,
              search: t.search,
              emptyText: req.emptyText,
              onDelta: (d, v) => {
                job.snapshot.live[i] = v;
                job.dirty = true;
                emit(job, 'delta', { t: i, d });
              },
            })
            .then((v) => {
              job.snapshot.live[i] = v;
              emit(job, 'version', { t: i, v });
            }),
        ),
      );
      clearInterval(timer);
      await saving;
      if (job.discard) {
        await deleteMessage(db, userId, req.conversationId, req.messageId);
      } else {
        message = engine.composeMessage(job.snapshot);
        updatedAt = await writeMessage(db, userId, message, { lastMessageAt: Date.now() });
        if (!updatedAt) message = null;
      }
    } catch (err) {
      console.error('[omnichat] background reply failed', err);
    } finally {
      clearInterval(timer);
      await db.run('DELETE FROM jobs WHERE user_id = ? AND message_id = ?', [userId, req.messageId]).catch(() => {});
      jobs.delete(key);
    }
    emit(job, 'done', { message, updatedAt });

    const reply = message && job.snapshot.live.find((v) => v.status === 'done')?.content;
    if (titleModel && reply) {
      const title = await nameChat(db, userId, req, reply, titleModel).catch(() => null);
      if (title) emit(job, 'title', { title });
    }
    for (const l of [...job.listeners]) l.close();
  }

  // Starts a reply and streams it. The reply keeps going (and is saved) if this request goes away.
  app.post('/api/generate', bodyLimit({ maxSize: 64 * 1024 * 1024, onError: () => fail(413, 'Payload too large') }), async (c) => {
    const req = validRequest(await c.req.json().catch(() => null));
    const db = c.get('db');
    const userId = c.get('user').id;
    const key = jobKey(userId, req.conversationId);
    if (jobs.has(key)) fail(409, 'A reply is already being generated in this chat');
    const conv = await db.first<{ deleted: number }>("SELECT deleted FROM entities WHERE user_id = ? AND kind = 'conversation' AND id = ?", [
      userId,
      req.conversationId,
    ]);
    if (conv?.deleted) fail(404, 'Conversation not found');

    let search: SearchFn | undefined;
    const targets: { provider: Provider; fetch: ProviderFetcher; search?: SearchFn }[] = [];
    for (const t of req.targets) {
      const p = await deps.providerFor(c, t.providerId);
      if (t.searchTool) search ??= await deps.searchFor(c).catch((err: Error) => async () => Promise.reject(err));
      targets.push({ ...p, search: t.searchTool ? search : undefined });
    }
    let titleModel: { provider: Provider; fetch: ProviderFetcher; model: string } | null = null;
    if (req.title?.providerId && req.title.model) {
      titleModel = await deps
        .providerFor(c, req.title.providerId)
        .then((p) => ({ ...p, model: req.title!.model }))
        .catch(() => null);
    }
    // A second request may have started a job while this one was loading providers.
    if (jobs.has(key)) fail(409, 'A reply is already being generated in this chat');
    // Stopped before it started.
    if (c.req.raw.signal.aborted) return new Response(null, { status: 499 });

    const job: Job = {
      userId,
      snapshot: {
        conversationId: req.conversationId,
        messageId: req.messageId,
        createdAt: req.createdAt,
        prior: req.prior ?? [],
        live: targets.map((t, i) => ({ content: '', model: req.targets[i].model, providerId: t.provider.id, providerName: t.provider.name, status: 'streaming' })),
      },
      controller: new AbortController(),
      listeners: new Set(),
      discard: false,
      dirty: false,
    };
    jobs.set(key, job);
    const res = eventStream(job, c.req.raw.signal);
    void run(db, job, req, targets, titleModel);
    return res;
  });

  // Conversations with a reply being generated right now.
  app.get('/api/generate', (c) => {
    const prefix = `${c.get('user').id}:`;
    const conversations = [...jobs.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
    return c.json({ conversations });
  });

  // Follows a running reply (from another page, after a reload, or when a phone comes back to the app).
  app.get('/api/generate/:conversationId', (c) => {
    const job = jobs.get(jobKey(c.get('user').id, c.req.param('conversationId')));
    if (!job) fail(404, 'No reply is being generated in this chat');
    return eventStream(job, c.req.raw.signal);
  });

  app.post('/api/generate/:conversationId/stop', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const job = jobs.get(jobKey(c.get('user').id, c.req.param('conversationId')));
    if (!job) return c.json({ stopped: false });
    if (body?.discard === true) job.discard = true;
    job.controller.abort();
    return c.json({ stopped: true });
  });
}
