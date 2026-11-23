// API-level tests for auth, sync semantics, limits, the AI proxy and background generation.
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

console.log('▶ background generation');
r = await call('/api/auth/status');
check('status announces background generation', r.json?.features?.backgroundGeneration === true, r.json?.features);
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const genBody = (conversationId, messageId, model = 'mock-gpt', extra = {}) => ({
  conversationId,
  messageId,
  createdAt: Date.now(),
  targets: [{ providerId: 'p1', model }],
  messages: [{ role: 'user', content: 'Hi there' }],
  params: {},
  emptyText: 'empty',
  ...extra,
});
/** Starts a reply and reads only its first event, like a page that is closed right after sending. */
async function startAndLeave(body) {
  const ac = new AbortController();
  const res = await fetch(`${BASE}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: ac.signal,
  });
  const first = res.ok ? new TextDecoder().decode((await res.body.getReader().read()).value) : await res.text();
  ac.abort();
  return { status: res.status, first };
}
async function message(conversationId, id) {
  const x = await call(`/api/messages?conversationId=${conversationId}`);
  return x.json?.messages?.find((m) => m.id === id);
}
async function waitFor(fn, ms = 10_000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) {
    const v = await fn();
    if (v) return v;
  }
  return fn();
}
await push([{ kind: 'conversation', id: 'c-bg', data: { title: 'bg', createdAt: Date.now() } }]);
let g = await startAndLeave(genBody('c-bg', 'a-bg'));
check('a reply starts and streams its state first', g.status === 200 && g.first.startsWith('event: init'), g);
let msg = await waitFor(async () => {
  const m = await message('c-bg', 'a-bg');
  return m?.data.status === 'done' ? m : null;
});
check('the reply finishes and is saved after the page went away', msg?.data.status === 'done' && /Hello from \*\*mock-gpt/.test(msg.data.content), msg?.data);
check('it records usage and timing', msg?.data.usage?.output === 128 && msg.data.durationMs >= 0, msg?.data);
e = await entity('c-bg');
check('the conversation is bumped with lastMessageAt', e?.data.lastMessageAt > 0 && e.data.title === 'bg', e?.data);

g = await startAndLeave(genBody('c-bg', 'a-slow', 'mock-slow'));
r = await call('/api/generate');
check('running replies are listed', r.json?.conversations?.includes('c-bg'), r.json);
r = await call('/api/generate', { body: genBody('c-bg', 'a-other') });
check('a second reply in the same chat is refused while one runs', r.status === 409, r.status);
msg = await waitFor(async () => {
  const m = await message('c-bg', 'a-slow');
  return m?.data.status === 'streaming' && m.data.content ? m : null;
});
check('progress is saved while it streams', msg?.data.status === 'streaming' && msg.data.content.length > 0, msg?.data);
const attached = await fetch(`${BASE}/api/generate/c-bg`, { headers: { authorization: `Bearer ${token}` } });
const reader = attached.body.getReader();
let seen = '';
while (!/event: delta/.test(seen)) seen += new TextDecoder().decode((await reader.read()).value);
check('another page can follow it live', attached.status === 200 && seen.startsWith('event: init') && /"messageId":"a-slow"/.test(seen), seen.slice(0, 120));
r = await call('/api/generate/c-bg/stop', { body: {} });
check('stop is accepted', r.json?.stopped === true, r.json);
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  seen += new TextDecoder().decode(value);
}
check('followers get the saved message when it stops', /event: done\ndata: \{"message":\{[^\n]*"status":"aborted"/.test(seen), seen.slice(-300));
msg = await message('c-bg', 'a-slow');
check('a stopped reply is saved as stopped, with what it had written', msg?.data.status === 'aborted' && msg.data.content.length > 0, msg?.data);
r = await call('/api/generate/c-bg');
check('nothing to follow once it is done', r.status === 404, r.status);

g = await startAndLeave(genBody('c-bg', 'a-discard', 'mock-slow'));
await sleep(300);
await call('/api/generate/c-bg/stop', { body: { discard: true } });
msg = await waitFor(async () => {
  const m = await message('c-bg', 'a-discard');
  return !m || m.deleted ? { gone: true } : null;
});
check('a discarded reply is not kept', msg?.gone === true, msg);

await push([{ kind: 'message', id: 'a-del', data: { conversationId: 'c-bg', role: 'assistant', content: '', createdAt: Date.now() } }]);
g = await startAndLeave(genBody('c-bg', 'a-del', 'mock-slow'));
await sleep(300);
await push([{ kind: 'message', id: 'a-del', deleted: true }]);
await waitFor(async () => !(await call('/api/generate')).json?.conversations?.includes('c-bg'), 8000);
msg = await message('c-bg', 'a-del');
check('a reply deleted on another device stops and stays deleted', !msg, msg?.data);

await push([{ kind: 'conversation', id: 'c-title', data: { title: 'Hi there', createdAt: Date.now() } }]);
g = await startAndLeave(genBody('c-title', 'a-title', 'mock-gpt', { title: { providerId: 'p1', model: 'mock-gpt' } }));
e = await waitFor(async () => {
  const x = await entity('c-title');
  return x?.data.titleGenerated ? x : null;
});
check('the chat is named after its first reply', e?.data.title === 'Mock Chat Title' && e.data.titleGenerated === true, e?.data);

await push([{ kind: 'conversation', id: 'c-gone', deleted: true }]);
r = await call('/api/generate', { body: genBody('c-gone', 'a-gone') });
check('no replies in a deleted chat', r.status === 404, r.status);
r = await call('/api/generate', { body: { ...genBody('c-bg', 'a-x'), targets: [{ providerId: 'missing', model: 'm' }] } });
check('unknown providers are rejected', r.status === 404, r.status);

console.log('▶ image and video generation');
r = await call('/api/auth/status', { auth: false });
check('status announces the media store', r.json?.features?.mediaStore === true, r.json?.features);
const mediaLog = async () => (await (await fetch(`${MOCK}/__log`)).json()).filter((x) => /images|videos|video-relay|predict|gemini/.test(x.api));
const lastLog = async (api) => (await mediaLog()).filter((x) => x.api === api).pop();
const mediaFetch = (url, headers = {}) => fetch(BASE + url, { headers: { authorization: `Bearer ${token}`, ...headers } });
const done = (conversationId, id, ms = 20_000) =>
  waitFor(async () => {
    const m = await message(conversationId, id);
    return m && m.data.status !== 'streaming' ? m : null;
  }, ms);
const ask = (text, extra = {}) => ({ messages: [{ role: 'user', content: text }], ...extra });

await push([{ kind: 'conversation', id: 'c-img', data: { title: 'img', createdAt: Date.now() } }]);
await startAndLeave(genBody('c-img', 'a-img', 'gpt-image-1', ask('a red fox', { params: { media: { aspect: '16:9', count: 2, quality: 'low' } } })));
msg = await done('c-img', 'a-img');
const imgs = msg?.data.media ?? [];
check('gpt-image-1 replies with two stored images', msg?.data.status === 'done' && imgs.length === 2 && imgs.every((m) => /^\/api\/media\/[\w-]+\.png$/.test(m.url) && m.kind === 'image'), msg?.data);
check('the revised prompt and usage are kept', imgs[0]?.revisedPrompt === 'A refined prompt: a red fox' && msg?.data.usage?.output === 544, { media: imgs[0], usage: msg?.data.usage });
let lg = await lastLog('images');
check('aspect, count and quality map onto the Images API', lg?.size === '1536x1024' && lg.n === 2 && lg.quality === 'low' && lg.path === '/v1/images/generations', lg);
let fr = await mediaFetch(imgs[0]?.url ?? '/api/media/x');
let bytes = new Uint8Array(await fr.arrayBuffer());
check('stored images are served to their owner', fr.status === 200 && fr.headers.get('content-type') === 'image/png' && bytes[0] === 0x89 && bytes[1] === 0x50, fr.status);
fr = await fetch(BASE + (imgs[0]?.url ?? '/api/media/x'));
check('media needs a session', fr.status === 401, fr.status);
fr = await mediaFetch(imgs[0]?.url ?? '/api/media/x', { range: 'bytes=0-7' });
check('byte ranges are served', fr.status === 206 && (await fr.arrayBuffer()).byteLength === 8 && /^bytes 0-7\//.test(fr.headers.get('content-range') ?? ''), fr.status);
fr = await mediaFetch('/api/media/..%2F..%2Fomnichat.db');
check('media ids cannot escape the store', fr.status === 404, fr.status);

const RED_DOT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
await startAndLeave(
  genBody('c-img', 'a-edit', 'gpt-image-1', {
    messages: [{ role: 'user', content: 'make it blue', attachments: [{ id: 'att1', kind: 'image', name: 'fox.png', mime: 'image/png', size: 68, dataUrl: RED_DOT }] }],
  }),
);
msg = await done('c-img', 'a-edit');
lg = await lastLog('images');
check('an attached image turns the request into an edit', msg?.data.status === 'done' && lg?.path === '/v1/images/edits' && lg.files === 1 && lg.prompt === 'make it blue', { lg, status: msg?.data.status });

await startAndLeave(genBody('c-img', 'a-url', 'url-image-model', ask('a lighthouse', { params: { media: { aspect: '1:1' } } })));
msg = await done('c-img', 'a-url');
check('image links (Ark, Zhipu, SiliconFlow style) are downloaded into the store', msg?.data.status === 'done' && /^\/api\/media\/.+\.png$/.test(msg.data.media?.[0]?.url ?? ''), msg?.data);

await startAndLeave(genBody('c-img', 'a-fail', 'gpt-image-1', ask('please fail')));
msg = await done('c-img', 'a-fail');
check('a refused prompt shows the provider error', msg?.data.status === 'error' && /safety system/.test(msg.data.error ?? ''), msg?.data);

await startAndLeave(genBody('c-img', 'a-sora', 'sora-2', ask('a paper boat', { params: { media: { aspect: '9:16', seconds: 7 } } })));
msg = await waitFor(async () => {
  const m = await message('c-img', 'a-sora');
  return m?.data.progress ? m : null;
});
check('video progress is saved while the job runs', !!msg?.data.progress?.stage && msg.data.status === 'streaming', msg?.data);
msg = await done('c-img', 'a-sora', 60_000);
const vid = msg?.data.media?.[0];
check('sora-2 replies with a stored mp4', msg?.data.status === 'done' && vid?.kind === 'video' && vid.mime === 'video/mp4' && /\.mp4$/.test(vid.url) && !msg.data.progress, msg?.data);
lg = await lastLog('videos');
check('duration and aspect map onto /videos', lg?.seconds === '8' && lg.size === '720x1280', lg);
fr = await mediaFetch(vid?.url ?? '/api/media/x');
check('the video is served', fr.status === 200 && fr.headers.get('content-type') === 'video/mp4', fr.status);

await startAndLeave(genBody('c-img', 'a-relay', 'relay-kling-v2', ask('a city at night', { params: { media: { seconds: 5, aspect: '16:9' } } })));
msg = await done('c-img', 'a-relay', 60_000);
lg = await lastLog('video-relay');
check('relays without /videos fall back to /video/generations', msg?.data.status === 'done' && msg.data.media?.[0]?.kind === 'video' && lg?.duration === 5 && lg.aspect === '16:9', { data: msg?.data, lg });

await push([{ kind: 'provider', id: 'p-gm', data: { name: 'Gemini', type: 'gemini', baseUrl: `${MOCK}/gemini/v1beta`, models: [], apiKey: 'gm-mock' } }]);
const gmBody = (id, model, extra) => ({ ...genBody('c-img', id, model, extra), targets: [{ providerId: 'p-gm', model }] });
await startAndLeave(gmBody('a-nano', 'gemini-2.5-flash-image', ask('a cat', { params: { media: { aspect: '4:3' }, reasoningEffort: 'high' } })));
msg = await done('c-img', 'a-nano');
lg = (await mediaLog()).filter((x) => x.api === 'gemini').pop();
check('Gemini image models return text and an image', msg?.data.content === 'Here is your picture.' && msg.data.media?.length === 1, msg?.data);
check('they are asked for images, without thinking settings', lg?.modalities?.includes('IMAGE') && lg.aspect === '4:3' && !lg.body?.generationConfig?.thinkingConfig, lg);
await startAndLeave(
  gmBody('a-nano2', 'gemini-2.5-flash-image', {
    messages: [
      { role: 'user', content: 'a cat' },
      { role: 'assistant', content: 'Here is your picture.', media: msg?.data.media },
      { role: 'user', content: 'give it a hat' },
    ],
  }),
);
msg = await done('c-img', 'a-nano2');
lg = (await mediaLog()).filter((x) => x.api === 'gemini').pop();
check('the next turn sends the earlier image back so it can be edited', msg?.data.status === 'done' && lg?.priorImages === 1, lg);

await startAndLeave(gmBody('a-imagen', 'imagen-4.0-generate-001', ask('a mountain', { params: { media: { count: 3, aspect: '16:9' } } })));
msg = await done('c-img', 'a-imagen');
lg = await lastLog('predict');
check('Imagen returns the requested number of images', msg?.data.media?.length === 3 && lg?.parameters?.sampleCount === 3 && lg.parameters.aspectRatio === '16:9', { media: msg?.data.media?.length, lg });

await startAndLeave(gmBody('a-veo', 'veo-3.0-generate-001', ask('waves on a beach', { params: { media: { aspect: '9:16', seconds: 5 } } })));
msg = await done('c-img', 'a-veo', 60_000);
lg = await lastLog('predictLongRunning');
check('Veo: the operation is polled and the file downloaded with the key', msg?.data.status === 'done' && msg.data.media?.[0]?.mime === 'video/mp4', msg?.data);
check('Veo parameters', lg?.parameters?.aspectRatio === '9:16' && lg.parameters.durationSeconds === 4, lg);

// Alibaba Model Studio through a gateway address that ends in /compatible-mode/v1 (e.g. QwenCloud Token Plan).
await push([{ kind: 'provider', id: 'p-ds', data: { name: 'QwenCloud', type: 'openai', presetId: 'custom-openai', baseUrl: `${MOCK}/compatible-mode/v1`, models: [], apiKey: 'sk-mock' } }]);
const dsBody = (id, model, extra) => ({ ...genBody('c-img', id, model, extra), targets: [{ providerId: 'p-ds', model }] });
const dsLog = async () => (await (await fetch(`${MOCK}/__log`)).json()).filter((x) => x.api === 'dashscope').pop();
await startAndLeave(dsBody('a-qwen', 'qwen-image-3.0-pro', ask('海报：秋天的猫', { params: { media: { aspect: '16:9', count: 2 } } })));
msg = await done('c-img', 'a-qwen');
lg = await dsLog();
check('qwen-image-3.0-pro: native sync API under the same host, two images stored', msg?.data.status === 'done' && msg.data.media?.length === 2 && lg?.path === '/api/v1/services/aigc/multimodal-generation/generation' && lg.parameters?.size === '1776*992' && lg.parameters.n === 2 && lg.parameters.watermark === false, { data: msg?.data, lg });
await startAndLeave(dsBody('a-wan27', 'wan2.7-image-pro', ask('雪山日出', { params: { media: { aspect: '1:1' } } })));
msg = await done('c-img', 'a-wan27', 60_000);
lg = await dsLog();
check('wan2.7-image-pro: image-generation task, polled until done', msg?.data.status === 'done' && msg.data.media?.length === 1 && lg?.path === '/api/v1/services/aigc/image-generation/generation' && lg.async && lg.parameters?.size === '2048*2048', { data: msg?.data, lg });
await startAndLeave(
  dsBody('a-wan27e', 'wan2.7-image-pro', {
    messages: [{ role: 'user', content: '把天空改成晚霞', attachments: [{ id: 'att2', kind: 'image', name: 'sky.png', mime: 'image/png', size: 68, dataUrl: RED_DOT }] }],
  }),
);
msg = await done('c-img', 'a-wan27e', 60_000);
lg = await dsLog();
check('wan2.7-image-pro: an attached image is sent in the message for editing', msg?.data.status === 'done' && lg?.images === 1 && lg.text === '把天空改成晚霞' && !lg.parameters?.size, lg);
await startAndLeave(dsBody('a-wan3v', 'wan3.0-video', ask('海浪', { params: { media: { aspect: '9:16', seconds: 10, resolution: '720p' } } })));
msg = await done('c-img', 'a-wan3v', 60_000);
lg = await dsLog();
check('wan3.0-video: video-synthesis task with ratio, duration and resolution', msg?.data.status === 'done' && msg.data.media?.[0]?.kind === 'video' && lg?.parameters?.ratio === '9:16' && lg.parameters.duration === 10 && lg.parameters.resolution === '720P' && lg.text === '海浪', { data: msg?.data, lg });

const up = await fetch(`${BASE}/api/media`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'image/png' }, body: Buffer.from(RED_DOT.split(',')[1], 'base64') });
const upJson = await up.json().catch(() => null);
check('the browser can upload media it generated', up.status === 200 && /^\/api\/media\/.+\.png$/.test(upJson?.url ?? ''), upJson);
const bad = await fetch(`${BASE}/api/media`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'image/png' }, body: '<html>not an image</html>' });
check('only images and videos are stored', bad.status === 400, bad.status);

console.log('▶ search and export');
r = await call('/api/search?q=y');
check('search endpoint responds', Array.isArray(r.json?.results), r.json);
r = await call('/api/export');
check('export contains entities and messages, no keys by default', r.json?.app === 'omnichat' && r.json.messages.length >= 1 && !r.json.keys, Object.keys(r.json ?? {}));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll API checks passed.');
process.exit(failures ? 1 : 0);
