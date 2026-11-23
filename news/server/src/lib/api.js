// HTTP 接口。与 Azure Functions 无关的纯路由：handle(req) → { status, json?, headers? }，便于测试。
//
// 公开：
//   GET  /editions/latest         最新一期
//   GET  /editions                往期列表
//   GET  /editions/{date}         某一天
//   GET  /push/key                推送公钥
//   POST /push/subscribe          订阅推送（不登录也可以）
//   POST /push/unsubscribe
// 通行密钥：
//   POST /auth/register/options   { name }    登录状态下调用 = 给当前账号添加一把新密钥
//   POST /auth/register/verify    { challengeId, response }
//   POST /auth/login/options
//   POST /auth/login/verify       { challengeId, response }
//   POST /auth/logout
// 需要登录（Authorization: Bearer <token>）：
//   GET  /me                      账号、偏好、已读
//   PUT  /me/prefs                { categories?: string[] }   关注的分类
//   POST /me/read                 { ids: [...] }
//   GET  /me/bookmarks
//   PUT  /me/bookmarks/{id}       { title, url, summary?, date?, category? }
//   DELETE /me/bookmarks/{id}
import { randomBytes, randomUUID } from 'node:crypto';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { hashKey, mergeRead } from './store.js';

const SESSION_DAYS = 180;
const CHALLENGE_MINUTES = 5;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new HttpError(status, message);
};

const b64u = {
  enc: (bytes) => Buffer.from(bytes).toString('base64url'),
  dec: (s) => new Uint8Array(Buffer.from(s, 'base64url')),
};

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);

/**
 * @param {{store: object, env?: object, webauthn?: object}} deps
 *   webauthn 可替换成假的实现（测试用）
 */
export function createApi({ store, env = process.env, webauthn } = {}) {
  const wa = webauthn ?? { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse };
  const allowedOrigins = String(env.APP_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const rpID = env.RP_ID;
  const rpName = env.RP_NAME || '科技晨读';

  function cors(origin) {
    if (!origin || !allowedOrigins.includes(origin)) return {};
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
  }

  async function currentUser(req, { required = true } = {}) {
    const m = String(req.headers.authorization ?? '').match(/^Bearer\s+([\w-]{20,})$/);
    if (m) {
      const s = await store.getSession(hashKey(m[1]));
      if (s && s.expires > Date.now()) {
        const user = await store.getUser(s.userId);
        if (user) return user;
      }
    }
    if (required) fail(401, '请先登录');
    return null;
  }

  async function newSession(userId) {
    const token = randomBytes(32).toString('base64url');
    await store.putSession(hashKey(token), { userId, expires: Date.now() + SESSION_DAYS * 86400_000 });
    return token;
  }

  function requireRp() {
    if (!rpID || !allowedOrigins.length) fail(503, '服务器还没有配置通行密钥（RP_ID / APP_ORIGINS）');
  }

  const routes = [
    ['GET', /^\/editions\/latest$/, async () => {
      const ed = await store.getLatestEdition();
      return ed ? { json: ed, cache: 300 } : fail(404, '还没有任何一期');
    }],
    ['GET', /^\/editions$/, async () => ({ json: await store.listEditions(90), cache: 300 })],
    ['GET', /^\/editions\/(\d{4}-\d{2}-\d{2})$/, async (req, [date]) => {
      const ed = await store.getEdition(date);
      return ed ? { json: ed, cache: 3600 } : fail(404, `没有 ${date} 这一期`);
    }],

    ['GET', /^\/push\/key$/, async () => (env.VAPID_PUBLIC_KEY ? { json: { key: env.VAPID_PUBLIC_KEY } } : fail(503, '服务器还没有配置推送'))],
    ['POST', /^\/push\/subscribe$/, async (req) => {
      const sub = req.body?.subscription;
      if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) fail(400, '推送订阅格式不对');
      const user = await currentUser(req, { required: false });
      await store.putPush({ endpoint: sub.endpoint, keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) }, userId: user?.id ?? null, createdAt: new Date().toISOString() });
      return { json: { ok: true } };
    }],
    ['POST', /^\/push\/unsubscribe$/, async (req) => {
      const endpoint = str(req.body?.endpoint, 2000);
      if (!endpoint) fail(400, '缺少 endpoint');
      await store.deletePush(endpoint);
      return { json: { ok: true } };
    }],

    ['POST', /^\/auth\/register\/options$/, async (req) => {
      requireRp();
      const existing = await currentUser(req, { required: false });
      const name = str(req.body?.name, 40)?.trim() || existing?.name || '读者';
      const userId = existing?.id ?? randomUUID();
      const creds = existing ? await store.listCredentials(existing.id) : [];
      const options = await wa.generateRegistrationOptions({
        rpName,
        rpID,
        userName: name,
        userDisplayName: name,
        userID: new TextEncoder().encode(userId),
        attestationType: 'none',
        excludeCredentials: creds.map((c) => ({ id: c.id, transports: c.transports })),
        authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      });
      const challengeId = randomUUID();
      await store.putChallenge(challengeId, { challenge: options.challenge, kind: 'register', userId, name, isNew: !existing, expires: Date.now() + CHALLENGE_MINUTES * 60_000 });
      return { json: { challengeId, options } };
    }],
    ['POST', /^\/auth\/register\/verify$/, async (req) => {
      requireRp();
      const ch = await store.takeChallenge(String(req.body?.challengeId ?? ''));
      if (!ch || ch.kind !== 'register') fail(400, '注册已过期，请重试');
      let result;
      try {
        result = await wa.verifyRegistrationResponse({ response: req.body?.response, expectedChallenge: ch.challenge, expectedOrigin: allowedOrigins, expectedRPID: rpID, requireUserVerification: false });
      } catch (err) {
        fail(400, `通行密钥验证失败：${err.message}`);
      }
      if (!result.verified || !result.registrationInfo) fail(400, '通行密钥验证失败');
      const { credential } = result.registrationInfo;
      if (ch.isNew) await store.createUser({ id: ch.userId, name: ch.name, createdAt: new Date().toISOString() });
      await store.putCredential({ id: credential.id, userId: ch.userId, publicKey: b64u.enc(credential.publicKey), counter: credential.counter, transports: credential.transports ?? [], createdAt: new Date().toISOString() });
      const user = await store.getUser(ch.userId);
      return { json: { token: await newSession(ch.userId), user } };
    }],
    ['POST', /^\/auth\/login\/options$/, async () => {
      requireRp();
      const options = await wa.generateAuthenticationOptions({ rpID, userVerification: 'preferred' });
      const challengeId = randomUUID();
      await store.putChallenge(challengeId, { challenge: options.challenge, kind: 'login', expires: Date.now() + CHALLENGE_MINUTES * 60_000 });
      return { json: { challengeId, options } };
    }],
    ['POST', /^\/auth\/login\/verify$/, async (req) => {
      requireRp();
      const ch = await store.takeChallenge(String(req.body?.challengeId ?? ''));
      if (!ch || ch.kind !== 'login') fail(400, '登录已过期，请重试');
      const credId = str(req.body?.response?.id, 1024);
      const cred = credId && (await store.getCredential(credId));
      if (!cred) fail(400, '这把通行密钥没有注册过');
      let result;
      try {
        result = await wa.verifyAuthenticationResponse({
          response: req.body.response,
          expectedChallenge: ch.challenge,
          expectedOrigin: allowedOrigins,
          expectedRPID: rpID,
          credential: { id: cred.id, publicKey: b64u.dec(cred.publicKey), counter: cred.counter, transports: cred.transports },
          requireUserVerification: false,
        });
      } catch (err) {
        fail(400, `通行密钥验证失败：${err.message}`);
      }
      if (!result.verified) fail(400, '通行密钥验证失败');
      await store.putCredential({ ...cred, counter: result.authenticationInfo.newCounter, lastUsedAt: new Date().toISOString() });
      const user = await store.getUser(cred.userId);
      if (!user) fail(400, '账号不存在');
      return { json: { token: await newSession(user.id), user } };
    }],
    ['POST', /^\/auth\/logout$/, async (req) => {
      const m = String(req.headers.authorization ?? '').match(/^Bearer\s+([\w-]+)$/);
      if (m) await store.deleteSession(hashKey(m[1]));
      return { json: { ok: true } };
    }],

    ['GET', /^\/me$/, async (req) => {
      const user = await currentUser(req);
      const state = await store.getState(user.id);
      const passkeys = (await store.listCredentials(user.id)).length;
      return { json: { user, prefs: state.prefs ?? {}, read: state.read ?? [], passkeys } };
    }],
    ['PUT', /^\/me\/prefs$/, async (req) => {
      const user = await currentUser(req);
      const state = await store.getState(user.id);
      const b = req.body ?? {};
      const prefs = { ...state.prefs };
      if (Array.isArray(b.categories)) prefs.categories = b.categories.filter((c) => typeof c === 'string').slice(0, 20).map((c) => c.slice(0, 20));
      await store.putState(user.id, { ...state, prefs });
      return { json: { prefs } };
    }],
    ['POST', /^\/me\/read$/, async (req) => {
      const user = await currentUser(req);
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 500) : fail(400, 'ids 必须是数组');
      const state = await store.getState(user.id);
      const read = mergeRead(state.read ?? [], ids);
      await store.putState(user.id, { ...state, read });
      return { json: { count: read.length } };
    }],
    ['GET', /^\/me\/bookmarks$/, async (req) => {
      const user = await currentUser(req);
      return { json: await store.listBookmarks(user.id) };
    }],
    ['PUT', /^\/me\/bookmarks\/([\w-]{1,64})$/, async (req, [id]) => {
      const user = await currentUser(req);
      const b = req.body ?? {};
      const url = str(b.url, 2000);
      if (!str(b.title, 300) || !url || !/^https?:\/\//.test(url)) fail(400, '收藏需要标题和链接');
      const bookmark = {
        id,
        title: str(b.title, 300),
        url,
        summary: str(b.summary, 2000),
        date: DATE_RE.test(b.date ?? '') ? b.date : null,
        category: str(b.category, 20),
        source: str(b.source, 100),
        savedAt: new Date().toISOString(),
      };
      await store.putBookmark(user.id, bookmark);
      return { json: bookmark };
    }],
    ['DELETE', /^\/me\/bookmarks\/([\w-]{1,64})$/, async (req, [id]) => {
      const user = await currentUser(req);
      await store.deleteBookmark(user.id, id);
      return { json: { ok: true } };
    }],
  ];

  /**
   * @param {{method: string, path: string, headers: Record<string, string>, body?: any}} req
   *   path 不含 /api 前缀；headers 的键为小写
   */
  return async function handle(req) {
    const headers = cors(req.headers.origin);
    if (req.method === 'OPTIONS') return { status: 204, headers };
    const path = req.path.replace(/\/+$/, '') || '/';
    try {
      for (const [method, re, fn] of routes) {
        const m = path.match(re);
        if (!m) continue;
        if (method !== req.method) continue;
        const res = await fn(req, m.slice(1));
        const cache = res.cache ? { 'Cache-Control': `public, max-age=${res.cache}` } : { 'Cache-Control': 'no-store' };
        return { status: res.status ?? 200, json: res.json, headers: { ...headers, ...cache } };
      }
      const known = routes.some(([, re]) => re.test(path));
      fail(known ? 405 : 404, known ? '不支持这个请求方法' : '没有这个接口');
    } catch (err) {
      if (err instanceof HttpError) return { status: err.status, json: { error: err.message }, headers };
      console.error(err);
      return { status: 500, json: { error: '服务器出错了' }, headers };
    }
  };
}

