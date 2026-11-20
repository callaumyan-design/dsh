// 数据存储。两种实现，接口相同：
//   memoryStore()          测试和本地试跑用
//   azureStore(connection)  线上：每期新闻存 Blob，账号、通行密钥、会话、收藏、推送订阅存 Table
import { createHash } from 'node:crypto';

export const hashKey = (s) => createHash('sha256').update(String(s)).digest('base64url');

const READ_LIMIT = 2000; // 已读记录只留最近这么多条

export function mergeRead(existing, ids) {
  const set = new Set(existing);
  for (const id of ids) if (typeof id === 'string' && id.length <= 64) set.add(id);
  return [...set].slice(-READ_LIMIT);
}

const indexEntry = (ed) => ({ date: ed.date, headline: ed.headline ?? null, storyCount: ed.stories?.length ?? 0, generatedAt: ed.generatedAt });

export function memoryStore() {
  const editions = new Map();
  const t = { users: new Map(), credentials: new Map(), challenges: new Map(), sessions: new Map(), state: new Map(), bookmarks: new Map(), push: new Map() };
  const clone = (x) => (x == null ? x : structuredClone(x));
  return {
    _tables: t,
    async putEdition(ed) {
      editions.set(ed.date, clone(ed));
    },
    async getEdition(date) {
      return clone(editions.get(date) ?? null);
    },
    async getLatestEdition() {
      const last = [...editions.keys()].sort().at(-1);
      return last ? clone(editions.get(last)) : null;
    },
    async listEditions(limit = 60) {
      return [...editions.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit).map(indexEntry);
    },
    async createUser(user) {
      t.users.set(user.id, clone(user));
    },
    async getUser(id) {
      return clone(t.users.get(id) ?? null);
    },
    async putCredential(c) {
      t.credentials.set(c.id, clone(c));
    },
    async getCredential(id) {
      return clone(t.credentials.get(id) ?? null);
    },
    async listCredentials(userId) {
      return [...t.credentials.values()].filter((c) => c.userId === userId).map(clone);
    },
    async putChallenge(id, data) {
      t.challenges.set(id, clone(data));
    },
    async takeChallenge(id) {
      const c = t.challenges.get(id);
      t.challenges.delete(id);
      return c && c.expires > Date.now() ? clone(c) : null;
    },
    async putSession(tokenHash, data) {
      t.sessions.set(tokenHash, clone(data));
    },
    async getSession(tokenHash) {
      return clone(t.sessions.get(tokenHash) ?? null);
    },
    async deleteSession(tokenHash) {
      t.sessions.delete(tokenHash);
    },
    async getState(userId) {
      return clone(t.state.get(userId) ?? { read: [], prefs: {} });
    },
    async putState(userId, state) {
      t.state.set(userId, clone(state));
    },
    async listBookmarks(userId) {
      return [...(t.bookmarks.get(userId)?.values() ?? [])].sort((a, b) => b.savedAt.localeCompare(a.savedAt)).map(clone);
    },
    async putBookmark(userId, b) {
      if (!t.bookmarks.has(userId)) t.bookmarks.set(userId, new Map());
      t.bookmarks.get(userId).set(b.id, clone(b));
    },
    async deleteBookmark(userId, id) {
      t.bookmarks.get(userId)?.delete(id);
    },
    async putPush(sub) {
      t.push.set(hashKey(sub.endpoint), clone(sub));
    },
    async deletePush(endpoint) {
      t.push.delete(hashKey(endpoint));
    },
    async listPush() {
      return [...t.push.values()].map(clone);
    },
  };
}

/** Azure Storage 实现。connection 是存储账户的连接字符串（Functions 自带的 AzureWebJobsStorage 即可）。 */
export async function azureStore(connection) {
  const { TableClient, odata } = await import('@azure/data-tables');
  const { BlobServiceClient } = await import('@azure/storage-blob');

  const container = BlobServiceClient.fromConnectionString(connection).getContainerClient('editions');
  await container.createIfNotExists();
  const names = ['users', 'credentials', 'challenges', 'sessions', 'userstate', 'bookmarks', 'pushsubs'];
  const tables = Object.fromEntries(names.map((n) => [n, TableClient.fromConnectionString(connection, n, { allowInsecureConnection: /UseDevelopmentStorage|127\.0\.0\.1|localhost/.test(connection) })]));
  await Promise.all(
    Object.values(tables).map((tc) =>
      tc.createTable().catch((e) => {
        if (e.statusCode !== 409) throw e;
      }),
    ),
  );

  const get = async (table, pk, rk) => {
    try {
      return await tables[table].getEntity(pk, rk);
    } catch (e) {
      if (e.statusCode === 404) return null;
      throw e;
    }
  };
  const del = async (table, pk, rk) => {
    try {
      await tables[table].deleteEntity(pk, rk);
    } catch (e) {
      if (e.statusCode !== 404) throw e;
    }
  };
  const upsert = (table, entity) => tables[table].upsertEntity(entity, 'Replace');
  const list = async (table, filter) => {
    const out = [];
    for await (const e of tables[table].listEntities(filter ? { queryOptions: { filter } } : undefined)) out.push(e);
    return out;
  };
  // Table 的单个字符串字段最多 32K 个字符，复杂数据以 JSON 字符串存
  const json = (e, field) => (e?.[field] ? JSON.parse(e[field]) : null);

  const readBlob = async (name) => {
    const blob = container.getBlockBlobClient(name);
    try {
      return JSON.parse((await blob.downloadToBuffer()).toString('utf8'));
    } catch (e) {
      if (e.statusCode === 404) return null;
      throw e;
    }
  };
  const writeBlob = (name, data) => {
    const body = Buffer.from(JSON.stringify(data));
    return container.getBlockBlobClient(name).upload(body, body.length, { blobHTTPHeaders: { blobContentType: 'application/json; charset=utf-8' } });
  };

  return {
    async putEdition(ed) {
      await writeBlob(`${ed.date}.json`, ed);
      const index = (await readBlob('index.json')) ?? [];
      const next = [indexEntry(ed), ...index.filter((i) => i.date !== ed.date)].sort((a, b) => b.date.localeCompare(a.date));
      await writeBlob('index.json', next);
    },
    getEdition: (date) => readBlob(`${date}.json`),
    async getLatestEdition() {
      const [latest] = (await readBlob('index.json')) ?? [];
      return latest ? readBlob(`${latest.date}.json`) : null;
    },
    async listEditions(limit = 60) {
      return ((await readBlob('index.json')) ?? []).slice(0, limit);
    },
    createUser: (u) => upsert('users', { partitionKey: 'u', rowKey: u.id, name: u.name, createdAt: u.createdAt }),
    async getUser(id) {
      const e = await get('users', 'u', id);
      return e && { id: e.rowKey, name: e.name, createdAt: e.createdAt };
    },
    putCredential: (c) => upsert('credentials', { partitionKey: 'c', rowKey: c.id, userId: c.userId, data: JSON.stringify(c) }),
    async getCredential(id) {
      return json(await get('credentials', 'c', id), 'data');
    },
    async listCredentials(userId) {
      return (await list('credentials', odata`PartitionKey eq 'c' and userId eq ${userId}`)).map((e) => json(e, 'data'));
    },
    putChallenge: (id, d) => upsert('challenges', { partitionKey: 'ch', rowKey: id, data: JSON.stringify(d) }),
    async takeChallenge(id) {
      const d = json(await get('challenges', 'ch', id), 'data');
      await del('challenges', 'ch', id);
      return d && d.expires > Date.now() ? d : null;
    },
    putSession: (h, d) => upsert('sessions', { partitionKey: 's', rowKey: h, data: JSON.stringify(d) }),
    async getSession(h) {
      return json(await get('sessions', 's', h), 'data');
    },
    deleteSession: (h) => del('sessions', 's', h),
    async getState(userId) {
      return json(await get('userstate', 'st', userId), 'data') ?? { read: [], prefs: {} };
    },
    putState: (userId, st) => upsert('userstate', { partitionKey: 'st', rowKey: userId, data: JSON.stringify(st) }),
    async listBookmarks(userId) {
      return (await list('bookmarks', odata`PartitionKey eq ${userId}`)).map((e) => json(e, 'data')).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    },
    putBookmark: (userId, b) => upsert('bookmarks', { partitionKey: userId, rowKey: b.id, data: JSON.stringify(b) }),
    deleteBookmark: (userId, id) => del('bookmarks', userId, id),
    putPush: (sub) => upsert('pushsubs', { partitionKey: 'p', rowKey: hashKey(sub.endpoint), data: JSON.stringify(sub) }),
    deletePush: (endpoint) => del('pushsubs', 'p', hashKey(endpoint)),
    async listPush() {
      return (await list('pushsubs')).map((e) => json(e, 'data'));
    },
  };
}
