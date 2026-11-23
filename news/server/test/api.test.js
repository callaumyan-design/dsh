import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/lib/api.js';
import { memoryStore } from '../src/lib/store.js';
import { broadcast, notificationFor } from '../src/lib/push.js';

const ORIGIN = 'https://me.github.io';
const env = { APP_ORIGINS: ORIGIN, RP_ID: 'me.github.io', VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' };

// 假的 WebAuthn：只检查参数是否传对
const fakeWebauthn = {
  calls: [],
  async generateRegistrationOptions(o) { this.calls.push(['regopt', o]); return { challenge: 'c-reg', rp: { id: o.rpID } }; },
  async verifyRegistrationResponse(o) {
    this.calls.push(['regver', o]);
    if (o.response?.bad) throw new Error('bad signature');
    return { verified: true, registrationInfo: { credential: { id: o.response.id, publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['internal'] } } };
  },
  async generateAuthenticationOptions(o) { this.calls.push(['authopt', o]); return { challenge: 'c-auth' }; },
  async verifyAuthenticationResponse(o) { this.calls.push(['authver', o]); return { verified: true, authenticationInfo: { newCounter: 7 } }; },
};

function setup() {
  const store = memoryStore();
  const handle = createApi({ store, env, webauthn: fakeWebauthn });
  const call = (method, path, { body, token, origin = ORIGIN } = {}) =>
    handle({ method, path, body, headers: { origin, ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  return { store, call };
}

async function register(call, name = '小明', token) {
  const opt = await call('POST', '/auth/register/options', { body: { name }, token });
  assert.equal(opt.status, 200);
  const ver = await call('POST', '/auth/register/verify', { body: { challengeId: opt.json.challengeId, response: { id: `cred-${Math.random().toString(36).slice(2)}` } }, token });
  assert.equal(ver.status, 200, JSON.stringify(ver.json));
  return ver.json;
}

test('每期新闻：最新、列表、指定日期、缓存头', async () => {
  const { store, call } = setup();
  assert.equal((await call('GET', '/editions/latest')).status, 404);
  await store.putEdition({ date: '2026-11-20', headline: 'A', stories: [{}], generatedAt: 'x' });
  await store.putEdition({ date: '2026-11-21', headline: 'B', stories: [], generatedAt: 'y' });
  const latest = await call('GET', '/editions/latest');
  assert.equal(latest.json.date, '2026-11-21');
  assert.equal(latest.headers['Cache-Control'], 'public, max-age=300');
  assert.deepEqual((await call('GET', '/editions')).json.map((e) => [e.date, e.storyCount]), [['2026-11-21', 0], ['2026-11-20', 1]]);
  assert.equal((await call('GET', '/editions/2026-11-20')).json.headline, 'A');
  assert.equal((await call('GET', '/editions/2026-01-01')).status, 404);
  assert.equal((await call('GET', '/nope')).status, 404);
  assert.equal((await call('DELETE', '/editions')).status, 405);
});

test('CORS：只允许配置过的来源', async () => {
  const { call } = setup();
  const ok = await call('OPTIONS', '/me', { origin: ORIGIN });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers['Access-Control-Allow-Origin'], ORIGIN);
  const bad = await call('GET', '/editions', { origin: 'https://evil.example' });
  assert.equal(bad.headers['Access-Control-Allow-Origin'], undefined);
});

test('通行密钥：注册、登录、退出、给账号加第二把密钥', async () => {
  const { store, call } = setup();
  const { token, user } = await register(call);
  assert.equal(user.name, '小明');
  const [, regOpt] = fakeWebauthn.calls.findLast((c) => c[0] === 'regopt');
  assert.equal(regOpt.rpID, 'me.github.io');
  assert.equal(regOpt.authenticatorSelection.residentKey, 'required');
  const [, regVer] = fakeWebauthn.calls.findLast((c) => c[0] === 'regver');
  assert.deepEqual(regVer.expectedOrigin, [ORIGIN]);
  assert.equal(regVer.expectedChallenge, 'c-reg');

  const me = await call('GET', '/me', { token });
  assert.equal(me.json.user.id, user.id);
  assert.equal(me.json.passkeys, 1);

  // 已登录时再注册 = 同一个账号加一把密钥（比如换了台手机）
  await register(call, '随便', token);
  assert.equal((await call('GET', '/me', { token })).json.passkeys, 2);
  assert.equal(store._tables.users.size, 1);
  const [, second] = fakeWebauthn.calls.findLast((c) => c[0] === 'regopt');
  assert.equal(second.excludeCredentials.length, 1);

  // 登录
  const credId = [...store._tables.credentials.keys()][0];
  const lo = await call('POST', '/auth/login/options');
  const li = await call('POST', '/auth/login/verify', { body: { challengeId: lo.json.challengeId, response: { id: credId } } });
  assert.equal(li.status, 200);
  assert.equal(li.json.user.id, user.id);
  assert.equal((await store.getCredential(credId)).counter, 7);
  // 同一个 challenge 不能用第二次
  assert.equal((await call('POST', '/auth/login/verify', { body: { challengeId: lo.json.challengeId, response: { id: credId } } })).status, 400);

  await call('POST', '/auth/logout', { token: li.json.token });
  assert.equal((await call('GET', '/me', { token: li.json.token })).status, 401);
  assert.equal((await call('GET', '/me', { token })).status, 200); // 另一个会话不受影响
});

test('通行密钥：验证失败、未注册的密钥、过期的 challenge', async () => {
  const { call } = setup();
  const opt = await call('POST', '/auth/register/options', { body: { name: 'x' } });
  const bad = await call('POST', '/auth/register/verify', { body: { challengeId: opt.json.challengeId, response: { id: 'z', bad: true } } });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /bad signature/);
  const lo = await call('POST', '/auth/login/options');
  assert.match((await call('POST', '/auth/login/verify', { body: { challengeId: lo.json.challengeId, response: { id: 'unknown' } } })).json.error, /没有注册过/);
  assert.equal((await call('POST', '/auth/login/verify', { body: { challengeId: 'nope', response: {} } })).status, 400);
});

test('没有配置 RP 时给出明确提示', async () => {
  const handle = createApi({ store: memoryStore(), env: {}, webauthn: fakeWebauthn });
  const r = await handle({ method: 'POST', path: '/auth/login/options', headers: {} });
  assert.equal(r.status, 503);
});

test('同步：已读、偏好、收藏', async () => {
  const { call } = setup();
  assert.equal((await call('GET', '/me/bookmarks')).status, 401);
  const { token } = await register(call);
  await call('POST', '/me/read', { token, body: { ids: ['a', 'b'] } });
  await call('POST', '/me/read', { token, body: { ids: ['b', 'c', 42, 'x'.repeat(65)] } });
  assert.deepEqual((await call('GET', '/me', { token })).json.read, ['a', 'b', 'c']);
  await call('PUT', '/me/prefs', { token, body: { categories: ['数码', 'AI'] } });
  assert.deepEqual((await call('GET', '/me', { token })).json.prefs, { categories: ['数码', 'AI'] });

  const bad = await call('PUT', '/me/bookmarks/s1', { token, body: { title: 't', url: 'javascript:alert(1)' } });
  assert.equal(bad.status, 400);
  await call('PUT', '/me/bookmarks/s1', { token, body: { title: '苹果发布 M6', url: 'https://a.com/1', date: '2026-11-21', category: '数码' } });
  const list = (await call('GET', '/me/bookmarks', { token })).json;
  assert.deepEqual(list.map((b) => [b.id, b.title, b.date]), [['s1', '苹果发布 M6', '2026-11-21']]);
  await call('DELETE', '/me/bookmarks/s1', { token });
  assert.deepEqual((await call('GET', '/me/bookmarks', { token })).json, []);
});

test('推送：订阅、退订、群发并清理失效订阅', async () => {
  const { store, call } = setup();
  assert.equal((await call('GET', '/push/key')).json.key, 'pub');
  assert.equal((await call('POST', '/push/subscribe', { body: { subscription: { endpoint: 'http://insecure' } } })).status, 400);
  for (const e of ['https://push/a', 'https://push/gone', 'https://push/err']) {
    assert.equal((await call('POST', '/push/subscribe', { body: { subscription: { endpoint: e, keys: { p256dh: 'p', auth: 'a' } } } })).status, 200);
  }
  await call('POST', '/push/unsubscribe', { body: { endpoint: 'https://push/a' } });
  await call('POST', '/push/subscribe', { body: { subscription: { endpoint: 'https://push/b', keys: { p256dh: 'p', auth: 'a' } } } });

  const sent = [];
  const sender = {
    setVapidDetails(sub, pub, priv) { assert.equal(pub, 'pub'); },
    async sendNotification(sub, payload) {
      if (sub.endpoint.endsWith('gone')) throw Object.assign(new Error('gone'), { statusCode: 410 });
      if (sub.endpoint.endsWith('err')) throw Object.assign(new Error('err'), { statusCode: 500 });
      sent.push([sub.endpoint, JSON.parse(payload)]);
    },
  };
  const edition = { date: '2026-11-21', headline: '苹果 M6 发布', stories: [] };
  const r = await broadcast(store, edition, { env, sender, log: { warn() {} } });
  assert.deepEqual(r, { sent: 1, removed: 1, failed: 1 });
  assert.equal(sent[0][1].body, '苹果 M6 发布');
  assert.deepEqual((await store.listPush()).map((s) => s.endpoint).sort(), ['https://push/b', 'https://push/err']);
  assert.equal(notificationFor({ date: 'd', stories: [{ title: '头条' }] }).body, '头条');
  assert.deepEqual(await broadcast(store, edition, { env: {}, sender }), { sent: 0, removed: 0, failed: 0 });
});
