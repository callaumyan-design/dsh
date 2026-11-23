import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProvider, extractJson } from '../src/lib/ai/index.js';
import { anthropicProvider } from '../src/lib/ai/anthropic.js';
import { openaiProvider } from '../src/lib/ai/openai.js';
import { customProvider } from '../src/lib/ai/custom.js';

const schema = { type: 'object', properties: { a: { type: 'integer' } }, required: ['a'], additionalProperties: false };

test('按环境变量选择 AI', () => {
  assert.equal(createProvider({}), null);
  assert.equal(createProvider({ AI_PROVIDER: 'none', ANTHROPIC_API_KEY: 'k' }), null);
  assert.equal(createProvider({ ANTHROPIC_API_KEY: 'k' }).model, 'claude-opus-5-5');
  assert.equal(createProvider({ AI_PROVIDER: 'openai', AI_MODEL: 'deepseek-chat', AI_API_KEY: 'k' }).name, 'openai');
  assert.throws(() => createProvider({ AI_PROVIDER: 'openai' }), /AI_MODEL/);
  assert.throws(() => createProvider({ AI_PROVIDER: 'custom' }), /AI_BASE_URL/);
  assert.throws(() => createProvider({ AI_PROVIDER: 'gemini' }), /不认识/);
});

test('从回复里取 JSON', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('好的：\n```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(extractJson('结果是 {"a":3} 。'), { a: 3 });
  assert.throws(() => extractJson('没有'), /没有可解析的 JSON/);
});

test('Anthropic：结构化输出与拒绝回退', async () => {
  let req;
  const client = { beta: { messages: { create: async (r) => { req = r; return { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"a":1}' }] }; } } } };
  const ai = anthropicProvider({ ANTHROPIC_API_KEY: 'k' }, { client });
  assert.deepEqual(await ai.generateJson({ system: 's', prompt: 'p', schema }), { a: 1 });
  assert.equal(req.model, 'claude-opus-5-5');
  assert.equal(req.fallbacks, 'default');
  assert.deepEqual(req.output_config.format, { type: 'json_schema', schema });
  // 不支持回退的模型不带 fallbacks
  const old = anthropicProvider({ ANTHROPIC_API_KEY: 'k', AI_MODEL: 'claude-haiku-5-5' }, { client });
  await old.generateJson({ system: 's', prompt: 'p', schema });
  assert.equal(req.fallbacks, undefined);
  const refusing = anthropicProvider({}, { client: { beta: { messages: { create: async () => ({ stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] }) } } } });
  await assert.rejects(refusing.generateJson({ system: 's', prompt: 'p', schema }), /拒绝.*cyber/);
});

test('OpenAI 兼容接口：地址、密钥、JSON 模式', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '```json\n{"a":5}\n```' } }] });
  };
  const ds = openaiProvider({ AI_MODEL: 'deepseek-chat', AI_API_KEY: 'sk-1', AI_BASE_URL: 'https://api.deepseek.com/v1/' }, { fetchImpl });
  assert.deepEqual(await ds.generateJson({ system: 's', prompt: 'p', schema }), { a: 5 });
  assert.equal(calls[0].url, 'https://api.deepseek.com/v1/chat/completions');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-1');
  assert.deepEqual(calls[0].body.response_format, { type: 'json_object' });
  assert.equal(calls[0].body.max_tokens, 16000);
  assert.match(calls[0].body.messages[0].content, /JSON Schema/);

  const capped = openaiProvider({ AI_MODEL: 'deepseek-chat', AI_MAX_TOKENS: '8192' }, { fetchImpl });
  await capped.generateJson({ system: 's', prompt: 'p', schema });
  assert.equal(calls.at(-1).body.max_tokens, 8192);
  calls.length = 1;

  const az = openaiProvider({ AI_MODEL: 'gpt', AI_API_KEY: 'az', AI_AUTH_HEADER: 'api-key', AI_JSON_MODE: 'none', AI_BASE_URL: 'https://x.openai.azure.com/openai/deployments/gpt/chat/completions?api-version=2024-10-21' }, { fetchImpl });
  await az.generateJson({ system: 's', prompt: 'p', schema });
  assert.equal(calls[1].url, 'https://x.openai.azure.com/openai/deployments/gpt/chat/completions?api-version=2024-10-21');
  assert.equal(calls[1].init.headers['api-key'], 'az');
  assert.equal(calls[1].body.response_format, undefined);

  const bad = openaiProvider({ AI_MODEL: 'm' }, { fetchImpl: async () => new Response('nope', { status: 401 }) });
  await assert.rejects(bad.generateJson({ system: 's', prompt: 'p', schema }), /HTTP 401/);
});

test('自定义接口', async () => {
  let sent;
  const fetchImpl = async (url, init) => { sent = { url, body: JSON.parse(init.body) }; return Response.json({ result: { a: 9 } }); };
  const ai = customProvider({ AI_BASE_URL: 'https://my.server/ai' }, { fetchImpl });
  assert.deepEqual(await ai.generateJson({ system: 's', prompt: 'p', schema }), { a: 9 });
  assert.equal(sent.url, 'https://my.server/ai');
  assert.deepEqual(Object.keys(sent.body).sort(), ['maxTokens', 'prompt', 'schema', 'system']);
});
