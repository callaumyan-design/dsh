// 自定义接口：把请求原样 POST 给你自己的服务，由它决定用什么 AI。
//
// 请求体：{ "system": "...", "prompt": "...", "schema": { JSON Schema }, "maxTokens": 16000 }
// 响应：符合 schema 的 JSON 对象（也可以是 { "result": {...} }）
import { authHeaders } from './openai.js';

export function customProvider(env, { fetchImpl = fetch } = {}) {
  const url = env.AI_BASE_URL;
  if (!url) throw new Error('AI_PROVIDER=custom 时必须设置 AI_BASE_URL（你的接口完整地址）');
  return {
    name: 'custom',
    model: env.AI_MODEL || 'custom',
    async generateJson({ system, prompt, schema, maxTokens = 16000 }) {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(env) },
        body: JSON.stringify({ system, prompt, schema, maxTokens, model: env.AI_MODEL || undefined }),
        signal: AbortSignal.timeout(300_000),
      });
      if (!res.ok) throw new Error(`自定义 AI 接口返回 HTTP ${res.status}`);
      const data = await res.json();
      return data && typeof data === 'object' && 'result' in data ? data.result : data;
    },
  };
}
