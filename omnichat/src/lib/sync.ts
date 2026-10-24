// Sync engine: a persistent outbox of local changes plus incremental pulls from the server.
// The server is the source of truth; IndexedDB keeps a local cache so the app opens instantly.
import { api, ApiError } from './api';
import { idb } from './idb';
import { debounce } from './utils';
import type { EntityRecord, MessageRecord, PushOp } from '../../shared/types';

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncHandlers {
  applyEntities(records: EntityRecord[], replace: boolean, isPending: (key: string) => boolean): void;
  applyMessages(conversationId: string, records: MessageRecord[], replace: boolean, isPending: (key: string) => boolean): void;
  markSynced(results: { kind: string; id: string; updatedAt: number }[]): void;
  setStatus(status: SyncStatus, error?: string): void;
  onDropped?(op: PushOp, error: string): void;
  isLocked?(key: string): boolean;
}

let handlers: SyncHandlers | null = null;
/** Keys (e.g. "message:<id>") being written locally right now; remote copies must not overwrite them. */
export const localLocks = new Set<string>();
const outbox = new Map<string, { op: PushOp; seq: number }>();
const inflight = new Set<string>();
let seq = 0;
let cursor = 0;
let msgCursors: Record<string, number> = {};
let flushing: Promise<void> | null = null;
let pulling: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 1000;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let active = false;

const OVERLAP_MS = 5000;
const keyOf = (op: { kind: string; id: string }) => `${op.kind}:${op.id}`;

const persistOutbox = debounce(() => {
  void idb.put('meta', [...outbox.values()].map((v) => v.op), 'outbox');
}, 250);
const persistCursors = debounce(() => {
  void idb.put('meta', cursor, 'cursor');
  void idb.put('meta', msgCursors, 'msgCursors');
}, 500);

export function configureSync(h: SyncHandlers) {
  handlers = h;
}

/** Loads cursors and the pending outbox for this user (clearing the cache if another user was signed in). */
export async function initSync(userId: string) {
  const owner = await idb.get<string>('meta', 'userId');
  if (owner && owner !== userId) await idb.clearAll();
  await idb.put('meta', userId, 'userId');
  cursor = (await idb.get<number>('meta', 'cursor')) ?? 0;
  msgCursors = (await idb.get<Record<string, number>>('meta', 'msgCursors')) ?? {};
  const ops = (await idb.get<PushOp[]>('meta', 'outbox')) ?? [];
  outbox.clear();
  for (const op of ops) outbox.set(keyOf(op), { op, seq: ++seq });
  active = true;
}

export function hasPending(key: string) {
  return outbox.has(key) || inflight.has(key);
}

export function enqueue(op: PushOp) {
  outbox.set(keyOf(op), { op, seq: ++seq });
  persistOutbox();
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => void flush(), 400);
}

export function pendingCount() {
  return outbox.size;
}

/** Pushes all pending changes now. Never throws. */
export async function flushNow() {
  if (flushTimer) clearTimeout(flushTimer);
  await flush();
  if (flushing) await flushing;
}

function flush(): Promise<void> {
  if (!active || !handlers) return Promise.resolve();
  if (flushing) return flushing;
  if (!outbox.size) return Promise.resolve();
  flushing = doFlush().finally(() => {
    flushing = null;
  });
  return flushing;
}

async function doFlush() {
  const h = handlers!;
  h.setStatus('syncing');
  let single = false;
  try {
    while (outbox.size && active) {
      const chunk: { key: string; op: PushOp; seq: number }[] = [];
      let size = 0;
      for (const [key, entry] of outbox) {
        const len = JSON.stringify(entry.op).length;
        if (chunk.length && (single || size + len > 4_000_000 || chunk.length >= 200)) break;
        chunk.push({ key, ...entry });
        size += len;
      }
      chunk.forEach((c) => inflight.add(c.key));
      try {
        const res = await api<{ results: { kind: string; id: string; updatedAt: number }[] }>('/api/sync/push', {
          body: { ops: chunk.map((c) => c.op) },
        });
        for (const c of chunk) if (outbox.get(c.key)?.seq === c.seq) outbox.delete(c.key);
        h.markSynced(res.results);
      } catch (err) {
        const status = err instanceof ApiError ? err.status : 0;
        if (status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429) {
          // A rejected operation must not block the queue: retry one by one, then drop the offender.
          if (chunk.length > 1) {
            single = true;
            continue;
          }
          outbox.delete(chunk[0].key);
          h.onDropped?.(chunk[0].op, (err as Error).message);
          continue;
        }
        throw err;
      } finally {
        chunk.forEach((c) => inflight.delete(c.key));
        persistOutbox();
      }
    }
    retryDelay = 1000;
    h.setStatus('idle');
  } catch (err) {
    const offline = !(err instanceof ApiError) || err.status === 0;
    h.setStatus(offline ? 'offline' : 'error', (err as Error).message);
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => void flush(), retryDelay);
    retryDelay = Math.min(retryDelay * 2, 60_000);
  }
}

export function pull(): Promise<void> {
  if (!active || !handlers) return Promise.resolve();
  if (pulling) return pulling;
  const h = handlers;
  pulling = (async () => {
    const since = cursor ? Math.max(0, cursor - OVERLAP_MS) : 0;
    try {
      const res = await api<{ now: number; entities: EntityRecord[] }>(`/api/sync?since=${since}`);
      if (!active) return;
      h.applyEntities(
        res.entities.filter((e) => !hasPending(keyOf(e))),
        since === 0,
        hasPending,
      );
      cursor = res.now;
      persistCursors();
      if (!flushing) h.setStatus(outbox.size ? 'syncing' : 'idle');
    } catch (err) {
      const offline = !(err instanceof ApiError) || err.status === 0;
      if (!flushing) h.setStatus(offline ? 'offline' : 'error', (err as Error).message);
    }
  })().finally(() => {
    pulling = null;
  });
  return pulling;
}

const messagePulls = new Map<string, Promise<void>>();

export function pullMessages(conversationId: string): Promise<void> {
  if (!active || !handlers) return Promise.resolve();
  const existing = messagePulls.get(conversationId);
  if (existing) return existing;
  const h = handlers;
  const p = (async () => {
    const c = msgCursors[conversationId];
    const since = c ? Math.max(0, c - OVERLAP_MS) : 0;
    try {
      const res = await api<{ now: number; messages: MessageRecord[] }>(
        `/api/messages?conversationId=${encodeURIComponent(conversationId)}&since=${since}`,
      );
      if (!active) return;
      const blocked = (key: string) => hasPending(key) || localLocks.has(key) || !!h.isLocked?.(key);
      h.applyMessages(
        conversationId,
        res.messages.filter((m) => !blocked(`message:${m.id}`)),
        since === 0,
        blocked,
      );
      msgCursors[conversationId] = res.now;
      persistCursors();
    } catch {
      /* offline: cached messages stay visible */
    }
  })().finally(() => messagePulls.delete(conversationId));
  messagePulls.set(conversationId, p);
  return p;
}

export function messageCursor(conversationId: string) {
  return msgCursors[conversationId] ?? 0;
}

export function forgetConversation(conversationId: string) {
  delete msgCursors[conversationId];
  persistCursors();
}

const onVisible = () => {
  if (document.visibilityState === 'visible') {
    void pull();
    void flush();
  }
};
const onOnline = () => {
  retryDelay = 1000;
  void flush();
  void pull();
};

export function startAutoSync() {
  stopAutoSync();
  pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') void pull();
  }, 20_000);
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
  window.addEventListener('online', onOnline);
  void flush();
}

export function stopAutoSync() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  document.removeEventListener('visibilitychange', onVisible);
  window.removeEventListener('focus', onVisible);
  window.removeEventListener('online', onOnline);
}

/** Signs out locally: stops syncing and wipes the cache. */
export async function resetSync() {
  active = false;
  stopAutoSync();
  if (retryTimer) clearTimeout(retryTimer);
  if (flushTimer) clearTimeout(flushTimer);
  outbox.clear();
  inflight.clear();
  cursor = 0;
  msgCursors = {};
  await idb.clearAll();
}
