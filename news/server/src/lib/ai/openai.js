// OpenAI 兼容接口（/chat/completions）。OpenAI、DeepSeek、通义千问、Kimi、智谱、Ollama、Azure OpenAI 等都能用。
import { extractJson } from './json.js';

export function authHeaders(env) {
  const key = env.AI_API_KEY;
  if (!key) return {};
  const header = env.AI_AUTH_HEADER || 'Authorization';
  return { [header]: header.toLowerCase() === 'authorization' ? `Bearer ${key}` : key };
}

export function openaiProvider(env, { fetchImpl = fetch } = {}) {
  const base = (env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const url = /\/chat\/completions(\?|$)/.test(base) ? base : `${base}/chat/completions`;
  const model = env.AI_MODEL;
  if (!model) throw new Error('AI_PROVIDER=openai 时必须设置 AI_MODEL');
  const mode = (env.AI_JSON_MODE || 'json_object').toLowerCase();
  // 各家的输出上限不同（DeepSeek 是 8192），超过会直接报错，所以允许用 AI_MAX_TOKENS 压低
  const cap = Number(env.AI_MAX_TOKENS) || Infinity;

  return {
    name: 'openai',
    model,
    async generateJson({ system, prompt, schema, maxTokens = 16000 }) {
      const body = {
        model,
        max_tokens: Math.min(maxTokens, cap),
        messages: [
          { role: 'system', content: `${system}\n\n只输出一个 JSON 对象，符合这个 JSON Schema：\n${JSON.stringify(schema)}` },
          { role: 'user', content: prompt },
        ],
      };
      if (mode === 'json_object') body.response_format = { type: 'json_object' };
      if (mode === 'json_schema') body.response_format = { type: 'json_schema', json_schema: { name: 'result', schema, strict: true } };

      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(env) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(300_000),
      });
      if (!res.ok) throw new Error(`AI 接口返回 HTTP ${res.status}：${(await res.text()).slice(0, 300)}`);
      const data = await res.json();
      const choice = data.choices?.[0];
      if (choice?.finish_reason === 'length') throw new Error('AI 输出被长度上限截断');
      return extractJson(choice?.message?.content);
    },
  };
}
