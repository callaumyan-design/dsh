// Minimal IndexedDB wrapper used as a local cache (fast startup and offline reading).
// Every call degrades to a no-op when IndexedDB is unavailable.

const DB_NAME = 'omnichat';
const DB_VERSION = 1;

export type StoreName = 'entities' | 'messages' | 'meta';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('entities')) db.createObjectStore('entities', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('messages')) {
          const s = db.createObjectStore('messages', { keyPath: 'id' });
          s.createIndex('conversationId', 'conversationId', { unique: false });
        }
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => Promise<T> | T): Promise<T | undefined> {
  const db = await open();
  if (!db) return undefined;
  try {
    const t = db.transaction(store, mode);
    const result = await fn(t.objectStore(store));
    if (mode === 'readwrite') {
      await new Promise<void>((resolve, reject) => {
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      });
    }
    return result;
  } catch (err) {
    console.warn('[idb]', err);
    return undefined;
  }
}

export const idb = {
  get<T>(store: StoreName, key: IDBValidKey) {
    return tx(store, 'readonly', (s) => wrap(s.get(key) as IDBRequest<T>));
  },
  getAll<T>(store: StoreName) {
    return tx(store, 'readonly', (s) => wrap(s.getAll() as IDBRequest<T[]>)).then((r) => r ?? []);
  },
  getAllByIndex<T>(store: StoreName, index: string, value: IDBValidKey) {
    return tx(store, 'readonly', (s) => wrap(s.index(index).getAll(value) as IDBRequest<T[]>)).then((r) => r ?? []);
  },
  put(store: StoreName, value: unknown, key?: IDBValidKey) {
    return tx(store, 'readwrite', (s) => {
      s.put(value, key);
    });
  },
  putMany(store: StoreName, values: unknown[]) {
    if (!values.length) return Promise.resolve(undefined);
    return tx(store, 'readwrite', (s) => {
      for (const v of values) s.put(v);
    });
  },
  delete(store: StoreName, key: IDBValidKey) {
    return tx(store, 'readwrite', (s) => {
      s.delete(key);
    });
  },
  deleteMany(store: StoreName, keys: IDBValidKey[]) {
    if (!keys.length) return Promise.resolve(undefined);
    return tx(store, 'readwrite', (s) => {
      for (const k of keys) s.delete(k);
    });
  },
  async deleteByIndex(store: StoreName, index: string, value: IDBValidKey) {
    return tx(store, 'readwrite', async (s) => {
      const keys = await wrap(s.index(index).getAllKeys(value));
      for (const k of keys) s.delete(k);
    });
  },
  async clearAll() {
    for (const s of ['entities', 'messages', 'meta'] as StoreName[]) await tx(s, 'readwrite', (st) => wrap(st.clear()));
  },
};
