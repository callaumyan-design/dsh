// 所有 HTTP 接口：https://<应用名>.azurewebsites.net/api/...
import { app } from '@azure/functions';
import { createApi } from '../lib/api.js';
import { getStore } from '../lib/runtime.js';

let handlerPromise;
const getHandler = () => (handlerPromise ??= getStore().then((store) => createApi({ store })).catch((e) => { handlerPromise = undefined; throw e; }));

app.http('api', {
  route: '{*path}',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const handle = await getHandler();
    let body;
    if (['POST', 'PUT'].includes(request.method)) {
      const text = await request.text();
      if (text.length > 64_000) return { status: 413, jsonBody: { error: '请求太大' } };
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        return { status: 400, jsonBody: { error: '请求体不是 JSON' } };
      }
    }
    const res = await handle({
      method: request.method,
      path: '/' + (request.params.path ?? ''),
      headers: Object.fromEntries([...request.headers].map(([k, v]) => [k.toLowerCase(), v])),
      body,
    });
    return { status: res.status, headers: res.headers, ...(res.json !== undefined ? { jsonBody: res.json } : {}) };
  },
});
