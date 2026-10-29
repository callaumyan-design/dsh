// API-level tests for auth, sync semantics, limits and the AI proxy.
//   node scripts/api-test.mjs http://localhost:3101 http://127.0.0.1:3199   (fresh server, mock-ai running)
const BASE = process.argv[2] || 'http://localhost:3101';
const MOCK = process.argv[3] || 'http://127.0.0.1:3199';
let failures = 0;
let token = '';

async function call(path, { method, body, auth = true } = {}) {
  const res = await fetch(BASE + path, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(auth && token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, json, text };
}

function check(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`);
  }
}

const push = (ops) => call('/api/sync/push', { body: { ops } });
async function entity(id) {
  const r = await call('/api/sync?since=1');
  return r.json.entities.find((e) => e.id === id);
}

console.log('▶ auth');
let r = await call('/api/auth/status', { auth: false });
check('status reports no users on a fresh server', r.json?.hasUsers === false, r.json);
r = await call('/api/auth/register', { body: { username: 'admin', password: 'secret123' }, auth: false });
check('first registration creates the admin', r.json?.user?.isAdmin === true, r.json);
token = r.json?.token;
r = await call('/api/auth/register', { body: { username: 'other', password: 'secret123' }, auth: false });
check('registration closed after the admin exists', r.status === 403, r.status);
r = await call('/api/auth/login', { body: { username: 'admin', password: 'wrong-pass' }, auth: false });
check('wrong password rejected', r.status === 401, r.status);
r = await call('/api/sync', { auth: false });
check('API requires a session', r.status === 401, r.status);

console.log('▶ sync semantics');
await push([{ kind: 'conversation', id: 'c1', data: { title: 'A', createdAt: 1 } }]);
await push([{ kind: 'conversation', id: 'c1', data: { lastMessageAt: 5 }, patch: true }]);
let e = await entity('c1');
check('patch merges into the stored record', e?.data.title === 'A' && e?.data.lastMessageAt === 5, e?.data);
await push([{ kind: 'conversation', id: 'c1', data: { title: null, pinned: true }, patch: true }]);
e = await entity('c1');
check('null in a patch removes the field', !('title' in e.data) && e.data.pinned === true, e?.data);
await push([{ kind: 'conversation', id: 'c1', deleted: true }]);
await push([
  { kind: 'conversation', id: 'c1', data: { title: 'stale' }, patch: true },
  { kind: 'message', id: 'm1', data: { conversationId: 'c1', role: 'user', content: 'x', createdAt: 2 } },
]);
e = await entity('c1');
check('a stale patch does not resurrect a deleted conversation', e?.deleted === true, e);
r = await call('/api/messages?conversationId=c1');
check('messages are not attached to a deleted conversation', r.json.messages.length === 0, r.json);
await push([
  { kind: 'conversation', id: 'c1', data: { title: 'Restored', createdAt: 1 } },
  { kind: 'message', id: 'm2', data: { conversationId: 'c1', role: 'user', content: 'y', createdAt: 3 } },
]);
e = await entity('c1');
r = await call('/api/messages?conversationId=c1');
check('a full write (e.g. restoring a backup) re-creates it with its messages', !e.deleted && r.json.messages.length === 1, { e, r: r.json });

console.log('▶ provider keys and proxy');
await push([{ kind: 'provider', id: 'p1', data: { name: 'Mock', type: 'openai', baseUrl: `${MOCK}/v1`, models: [], apiKey: 'sk-mock' } }]);
e = await entity('p1');
check('API key is never returned by sync', !('apiKey' in e.data) && e.data.hasKey === true && e.data.keyHint, e.data);
await push([{ kind: 'provider', id: 'p1', data: { name: 'Renamed', type: 'openai', baseUrl: `${MOCK}/v1`, models: [] } }]);
r = await call('/api/providers/p1/key');
check('saving without apiKey keeps the stored key', r.json?.apiKey === 'sk-mock', r.json);
r = await call('/api/proxy/p1/models');
check('proxy attaches the key upstream', r.status === 200 && Array.isArray(r.json?.data), r.status);
await push([{ kind: 'provider', id: 'p2', data: { name: 'Bad', type: 'openai', baseUrl: 'ftp://example.com', models: [] } }]).then((x) =>
  check('non-http base URLs are rejected', x.status === 400, x.status),
);

console.log('▶ limits and validation');
r = await call('/api/auth/status');
const limits = r.json.limits;
check('status announces sync limits', limits?.maxOps > 0 && limits?.maxRecordBytes > 0, limits);
r = await push(Array.from({ length: limits.maxOps + 1 }, (_, i) => ({ kind: 'prompt', id: `p${i}`, data: {} })));
check('too many operations rejected with 400', r.status === 400, r.status);
r = await push([{ kind: 'message', id: 'big', data: { conversationId: 'c1', content: 'a'.repeat(limits.maxRecordBytes + 10) } }]);
check('oversized record rejected with 413', r.status === 413, r.status);
r = await push([{ kind: 'nope', id: 'x', data: {} }]);
check('unknown kind rejected', r.status === 400, r.status);

console.log('▶ usage statistics');
await push([
  { kind: 'conversation', id: 'c-stats', data: { title: 'stats', createdAt: Date.now() } },
  {
    kind: 'message',
    id: 'a-multi',
    data: {
      conversationId: 'c-stats', role: 'assistant', content: 'x', createdAt: Date.now(), model: 'm1', providerName: 'P', usage: { input: 10, output: 20 },
      versions: [
        { content: 'x', model: 'm1', providerName: 'P', usage: { input: 10, output: 20 }, status: 'done' },
        { content: 'y', model: 'm2', providerName: 'Q', usage: { input: 1, output: 2 }, status: 'done' },
      ],
      versionIndex: 0,
    },
  },
  { kind: 'message', id: 'a-single', data: { conversationId: 'c-stats', role: 'assistant', content: 'z', createdAt: Date.now(), model: 'm1', providerName: 'P', usage: { input: 5, output: 5 } } },
]);
r = await call(`/api/stats?days=7&tzOffset=${new Date().getTimezoneOffset()}`);
const m1 = r.json?.rows?.filter((x) => x.model === 'm1').reduce((acc, x) => ({ requests: acc.requests + x.requests, input: acc.input + x.input, output: acc.output + x.output }), { requests: 0, input: 0, output: 0 });
const m2 = r.json?.rows?.find((x) => x.model === 'm2');
check('stats count every version once (m1: 2 requests, 15 in / 25 out)', m1?.requests === 2 && m1.input === 15 && m1.output === 25, m1);
check('stats include the other model of a multi-model answer', m2?.requests === 1 && m2.input === 1 && m2.output === 2, m2);

console.log('▶ projects');
await push([
  { kind: 'project', id: 'proj1', data: { name: 'Thesis', instructions: 'Be brief', createdAt: 1 } },
  { kind: 'conversation', id: 'c-in-p1', data: { title: 'in project', projectId: 'proj1', createdAt: 1 } },
]);
r = await call('/api/sync?since=0&v=2');
check('projects sync to current clients', r.json?.entities?.some((x) => x.kind === 'project' && x.id === 'proj1' && x.data.name === 'Thesis'), r.json?.entities?.map((x) => x.kind));
r = await call('/api/sync?since=0');
check('projects are withheld from clients that predate them', r.json?.entities?.length > 0 && !r.json.entities.some((x) => x.kind === 'project'), r.json?.entities?.map((x) => x.kind));
check('their chats still reach older clients', r.json?.entities?.some((x) => x.id === 'c-in-p1'));
await push([{ kind: 'project', id: 'proj1', data: { instructions: null }, patch: true }]);
r = await call('/api/sync?since=1&v=2');
e = r.json?.entities?.find((x) => x.id === 'proj1');
check('project patches merge field by field', e?.data.name === 'Thesis' && !('instructions' in e.data), e?.data);

console.log('▶ search and export');
r = await call('/api/search?q=y');
check('search endpoint responds', Array.isArray(r.json?.results), r.json);
r = await call('/api/export');
check('export contains entities and messages, no keys by default', r.json?.app === 'omnichat' && r.json.messages.length >= 1 && !r.json.keys, Object.keys(r.json ?? {}));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll API checks passed.');
process.exit(failures ? 1 : 0);
