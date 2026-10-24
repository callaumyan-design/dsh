import { create } from 'zustand';
import { idb } from '@/lib/idb';
import {
  configureSync,
  enqueue,
  forgetConversation,
  initSync,
  messageCursor,
  pull,
  pullMessages,
  startAutoSync,
  type SyncStatus,
} from '@/lib/sync';
import { DEFAULT_SETTINGS, type Conversation, type Message, type Prompt, type Provider, type Settings } from '@/lib/types';
import type { EntityKind, MessageRecord } from '../../shared/types';

interface CachedEntity {
  key: string;
  kind: EntityKind;
  id: string;
  data: Record<string, unknown>;
}

interface DataState {
  hydrated: boolean;
  providers: Record<string, Provider>;
  conversations: Record<string, Conversation>;
  prompts: Record<string, Prompt>;
  settings: Settings;
  messages: Record<string, Message[]>;
  messagesLoaded: Record<string, boolean>;
  syncStatus: SyncStatus;
  syncError?: string;
}

export const useData = create<DataState>(() => ({
  hydrated: false,
  providers: {},
  conversations: {},
  prompts: {},
  settings: DEFAULT_SETTINGS,
  messages: {},
  messagesLoaded: {},
  syncStatus: 'idle',
}));

const SETTINGS_ID = 'user';
const set = useData.setState;
const get = useData.getState;

type Collection = 'providers' | 'conversations' | 'prompts';
const collectionOf: Record<Exclude<EntityKind, 'settings'>, Collection> = {
  provider: 'providers',
  conversation: 'conversations',
  prompt: 'prompts',
};

function strip<T extends { syncedAt?: number }>(obj: T): Record<string, unknown> {
  const { syncedAt: _s, ...rest } = obj;
  return rest as Record<string, unknown>;
}

const sortMessages = (list: Message[]) => list.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));

function toMessage(r: MessageRecord): Message {
  return { ...(r.data as Message), id: r.id, conversationId: r.conversationId, syncedAt: r.updatedAt };
}

// ---------- Sync handlers ----------

configureSync({
  applyEntities(records, replace, isPending) {
    const s = get();
    const next = {
      providers: { ...s.providers },
      conversations: { ...s.conversations },
      prompts: { ...s.prompts },
    };
    let settings = s.settings;
    const puts: CachedEntity[] = [];
    const dels: string[] = [];
    const seen = new Set<string>();
    const refetch: string[] = [];
    const removedConversations: string[] = [];

    for (const r of records) {
      const key = `${r.kind}:${r.id}`;
      seen.add(key);
      if (r.kind === 'settings') {
        if (r.deleted) continue;
        if ((settings.syncedAt ?? 0) > r.updatedAt) continue;
        settings = { ...DEFAULT_SETTINGS, ...(r.data as Partial<Settings>), syncedAt: r.updatedAt };
        puts.push({ key, kind: r.kind, id: r.id, data: { ...(r.data as object), syncedAt: r.updatedAt } });
        continue;
      }
      const coll = next[collectionOf[r.kind]] as Record<string, { syncedAt?: number }>;
      if (r.deleted) {
        if (coll[r.id]) delete coll[r.id];
        dels.push(key);
        if (r.kind === 'conversation') removedConversations.push(r.id);
        continue;
      }
      const local = coll[r.id];
      if (local && (local.syncedAt ?? 0) > r.updatedAt) continue;
      const value = { ...(r.data as object), id: r.id, syncedAt: r.updatedAt };
      coll[r.id] = value;
      puts.push({ key, kind: r.kind, id: r.id, data: value });
      if (r.kind === 'conversation' && s.messagesLoaded[r.id] && r.updatedAt > messageCursor(r.id)) refetch.push(r.id);
    }

    if (replace) {
      for (const kind of Object.keys(collectionOf) as Exclude<EntityKind, 'settings'>[]) {
        const coll = next[collectionOf[kind]] as Record<string, unknown>;
        for (const id of Object.keys(coll)) {
          const key = `${kind}:${id}`;
          if (!seen.has(key) && !isPending(key)) {
            delete coll[id];
            dels.push(key);
            if (kind === 'conversation') removedConversations.push(id);
          }
        }
      }
    }

    const messages = { ...s.messages };
    const loaded = { ...s.messagesLoaded };
    for (const id of removedConversations) {
      delete messages[id];
      delete loaded[id];
      forgetConversation(id);
      void idb.deleteByIndex('messages', 'conversationId', id);
    }
    set({ ...next, settings, messages, messagesLoaded: loaded });
    void idb.putMany('entities', puts);
    void idb.deleteMany('entities', dels);
    for (const id of refetch) void pullMessages(id);
  },

  applyMessages(conversationId, records, replace, isBlocked) {
    const s = get();
    const map = new Map((s.messages[conversationId] ?? []).map((m) => [m.id, m]));
    const puts: Message[] = [];
    const dels: string[] = [];
    if (replace) {
      const remote = new Set(records.map((r) => r.id));
      for (const id of [...map.keys()]) {
        if (!remote.has(id) && !isBlocked(`message:${id}`)) {
          map.delete(id);
          dels.push(id);
        }
      }
    }
    for (const r of records) {
      if (r.deleted) {
        map.delete(r.id);
        dels.push(r.id);
        continue;
      }
      const local = map.get(r.id);
      if (local && (local.syncedAt ?? 0) > r.updatedAt) continue;
      const m = toMessage(r);
      map.set(r.id, m);
      puts.push(m);
    }
    set({
      messages: { ...s.messages, [conversationId]: sortMessages([...map.values()]) },
      messagesLoaded: { ...s.messagesLoaded, [conversationId]: true },
    });
    void idb.putMany('messages', puts);
    void idb.deleteMany('messages', dels);
  },

  markSynced(results) {
    const s = get();
    const patch: Partial<DataState> = {};
    for (const r of results) {
      if (r.kind === 'message') continue;
      if (r.kind === 'settings') {
        patch.settings = { ...(patch.settings ?? s.settings), syncedAt: r.updatedAt };
        continue;
      }
      const name = collectionOf[r.kind as Exclude<EntityKind, 'settings'>];
      if (!name) continue;
      const coll = (patch[name] ?? { ...s[name] }) as Record<string, { syncedAt?: number }>;
      if (coll[r.id]) coll[r.id] = { ...coll[r.id], syncedAt: r.updatedAt };
      (patch as Record<string, unknown>)[name] = coll;
    }
    set(patch);
  },

  setStatus(syncStatus, syncError) {
    if (get().syncStatus !== syncStatus || get().syncError !== syncError) set({ syncStatus, syncError });
  },

  onDropped(op, error) {
    console.warn('[sync] change rejected by server', op.kind, op.id, error);
    window.dispatchEvent(new CustomEvent('omnichat:sync-rejected', { detail: { kind: op.kind, error } }));
  },
});

// ---------- Startup ----------

export async function hydrate(userId: string) {
  await initSync(userId);
  const cached = await idb.getAll<CachedEntity>('entities');
  const providers: Record<string, Provider> = {};
  const conversations: Record<string, Conversation> = {};
  const prompts: Record<string, Prompt> = {};
  let settings = DEFAULT_SETTINGS;
  for (const e of cached) {
    if (e.kind === 'provider') providers[e.id] = e.data as unknown as Provider;
    else if (e.kind === 'conversation') conversations[e.id] = e.data as unknown as Conversation;
    else if (e.kind === 'prompt') prompts[e.id] = e.data as unknown as Prompt;
    else if (e.kind === 'settings') settings = { ...DEFAULT_SETTINGS, ...(e.data as Partial<Settings>) };
  }
  set({ providers, conversations, prompts, settings, messages: {}, messagesLoaded: {}, hydrated: true });
  startAutoSync();
  await pull();
}

export function resetData() {
  set({
    hydrated: false,
    providers: {},
    conversations: {},
    prompts: {},
    settings: DEFAULT_SETTINGS,
    messages: {},
    messagesLoaded: {},
    syncStatus: 'idle',
    syncError: undefined,
  });
}

// ---------- Entity mutations ----------

function saveEntity(kind: Exclude<EntityKind, 'settings'>, obj: { id: string; syncedAt?: number }, extra?: Record<string, unknown>) {
  const name = collectionOf[kind];
  set((s) => ({ [name]: { ...s[name], [obj.id]: obj } }) as Partial<DataState>);
  void idb.put('entities', { key: `${kind}:${obj.id}`, kind, id: obj.id, data: obj });
  enqueue({ kind, id: obj.id, data: { ...strip(obj), ...extra } });
}

function removeEntity(kind: Exclude<EntityKind, 'settings'>, id: string) {
  const name = collectionOf[kind];
  set((s) => {
    const coll = { ...s[name] } as Record<string, unknown>;
    delete coll[id];
    return { [name]: coll } as Partial<DataState>;
  });
  void idb.delete('entities', `${kind}:${id}`);
  enqueue({ kind, id, deleted: true });
}

/** Saves a provider. Pass apiKey to set it (empty string clears it); omit to keep the stored key. */
export function saveProvider(p: Provider, apiKey?: string) {
  const local: Provider = { ...p };
  delete local.apiKey;
  if (apiKey !== undefined) {
    local.hasKey = !!apiKey.trim();
    local.keyHint = apiKey.trim() ? `${apiKey.trim().slice(0, 3)}…${apiKey.trim().slice(-4)}` : undefined;
  }
  saveEntity('provider', local, apiKey !== undefined ? { apiKey } : undefined);
}

export const removeProvider = (id: string) => removeEntity('provider', id);

export function saveConversation(c: Conversation) {
  saveEntity('conversation', c);
}

export function updateConversation(id: string, patch: Partial<Conversation>) {
  const c = get().conversations[id];
  if (!c) return;
  saveEntity('conversation', { ...c, ...patch });
}

export function removeConversation(id: string) {
  removeEntity('conversation', id);
  set((s) => {
    const messages = { ...s.messages };
    const loaded = { ...s.messagesLoaded };
    delete messages[id];
    delete loaded[id];
    return { messages, messagesLoaded: loaded };
  });
  forgetConversation(id);
  void idb.deleteByIndex('messages', 'conversationId', id);
}

export const savePrompt = (p: Prompt) => saveEntity('prompt', p);
export const removePrompt = (id: string) => removeEntity('prompt', id);

export function updateSettings(patch: Partial<Settings>) {
  const settings = { ...get().settings, ...patch };
  set({ settings });
  void idb.put('entities', { key: `settings:${SETTINGS_ID}`, kind: 'settings', id: SETTINGS_ID, data: settings });
  enqueue({ kind: 'settings', id: SETTINGS_ID, data: strip(settings) });
}

// ---------- Messages ----------

export async function loadMessages(conversationId: string) {
  if (!get().messagesLoaded[conversationId]) {
    const cached = await idb.getAllByIndex<Message>('messages', 'conversationId', conversationId);
    if (cached.length && !get().messagesLoaded[conversationId]) {
      set((s) => ({
        messages: { ...s.messages, [conversationId]: sortMessages(cached) },
        messagesLoaded: { ...s.messagesLoaded, [conversationId]: true },
      }));
    }
  }
  await pullMessages(conversationId);
}

/** Updates a message in memory only (used while streaming). */
export function setLocalMessage(msg: Message) {
  set((s) => {
    const list = s.messages[msg.conversationId] ?? [];
    const i = list.findIndex((m) => m.id === msg.id);
    const next = i >= 0 ? list.map((m) => (m.id === msg.id ? msg : m)) : sortMessages([...list, msg]);
    return { messages: { ...s.messages, [msg.conversationId]: next } };
  });
}

/** Saves a message locally and queues it for sync. */
export function saveMessage(msg: Message) {
  setLocalMessage(msg);
  void idb.put('messages', msg);
  const { syncedAt: _s, ...data } = msg;
  enqueue({ kind: 'message', id: msg.id, data });
}

export function deleteMessages(conversationId: string, ids: string[]) {
  if (!ids.length) return;
  const drop = new Set(ids);
  set((s) => ({
    messages: { ...s.messages, [conversationId]: (s.messages[conversationId] ?? []).filter((m) => !drop.has(m.id)) },
  }));
  void idb.deleteMany('messages', ids);
  for (const id of ids) enqueue({ kind: 'message', id, deleted: true });
}

export function getMessages(conversationId: string): Message[] {
  return get().messages[conversationId] ?? [];
}
