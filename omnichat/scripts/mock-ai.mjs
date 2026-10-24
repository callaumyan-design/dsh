// A tiny mock of the OpenAI, Anthropic and Gemini streaming APIs for local testing.
//   node scripts/mock-ai.mjs [port]
// OpenAI:    http://127.0.0.1:PORT/v1            (key: sk-mock)
// Anthropic: http://127.0.0.1:PORT/anthropic/v1  (key: sk-ant-mock)
// Gemini:    http://127.0.0.1:PORT/gemini/v1beta (key: gm-mock)
import http from 'node:http';

const port = Number(process.argv[2] || process.env.MOCK_PORT || 3199);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];

function reply(lastUser, model) {
  return [
    `Hello from **${model}**! You said: "${lastUser.slice(0, 80)}"`,
    '',
    'Here is a code sample:',
    '',
    '```python',
    'def greet(name):',
    '    return f"Hello, {name}!"',
    '```',
    '',
    '| Provider | Protocol |',
    '| --- | --- |',
    '| OpenAI | Chat Completions |',
    '| Claude | Messages |',
    '',
    'Euler: $e^{i\\pi} + 1 = 0$',
  ].join('\n');
}

const DEMO_REASONING =
  '用户想要快速排序的 Python 实现和复杂度分析。我应该先给出简洁易读的实现，再解释分治思路，最后用表格对比最好、平均、最坏情况，并给出平均情况的递推式。';

const DEMO_ANSWER = [
  '快速排序采用**分治**思想：选一个基准值（pivot），把数组分成「小于」「等于」「大于」三部分，再递归排序左右两边。',
  '',
  '```python',
  'def quick_sort(arr: list[int]) -> list[int]:',
  '    if len(arr) <= 1:',
  '        return arr',
  '    pivot = arr[len(arr) // 2]',
  '    left = [x for x in arr if x < pivot]',
  '    mid = [x for x in arr if x == pivot]',
  '    right = [x for x in arr if x > pivot]',
  '    return quick_sort(left) + mid + quick_sort(right)',
  '',
  '',
  'print(quick_sort([3, 6, 1, 8, 2, 9, 4]))  # [1, 2, 3, 4, 6, 8, 9]',
  '```',
  '',
  '### 时间复杂度',
  '',
  '| 情况 | 复杂度 | 说明 |',
  '| --- | --- | --- |',
  '| 最好 | $O(n \\log n)$ | 每次都恰好平分 |',
  '| 平均 | $O(n \\log n)$ | 随机数据下的期望 |',
  '| 最坏 | $O(n^2)$ | 每次选到最大/最小值 |',
  '',
  '平均情况满足递推式 $T(n) = 2T(n/2) + O(n)$，由主定理可得：',
  '',
  '$$T(n) = O(n \\log n)$$',
  '',
  '> 实际工程中常用**随机选取 pivot** 或**三数取中**来避免最坏情况。',
].join('\n');

function chunks(text, size = 6) {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

function lastUserText(messages) {
  const m = [...messages].reverse().find((x) => x.role === 'user');
  if (!m) return '';
  if (typeof m.content === 'string') return m.content;
  if (Array.isArray(m.content)) return m.content.map((p) => p.text).filter(Boolean).join(' ');
  if (Array.isArray(m.parts)) return m.parts.map((p) => p.text).filter(Boolean).join(' ');
  return '';
}

function isTitleRequest(text) {
  return /short title/i.test(text);
}

function answerFor(user, model, fallback) {
  if (isTitleRequest(user)) return /快速排序/.test(user) ? '快速排序与复杂度分析' : fallback;
  if (/快速排序/.test(user)) return DEMO_ANSWER;
  return reply(user, model);
}

async function readBody(req) {
  let s = '';
  for await (const c of req) s += c;
  try {
    return JSON.parse(s || '{}');
  } catch {
    return {};
  }
}

function sse(res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const p = url.pathname;
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', '*');
  if (req.method === 'OPTIONS') return res.end();
  if (p === '/__log') return json(res, 200, log);

  // ---------- OpenAI ----------
  if (p.startsWith('/v1/')) {
    if (req.headers.authorization !== 'Bearer sk-mock') return json(res, 401, { error: { message: 'Incorrect API key provided', type: 'invalid_request_error' } });
    if (p === '/v1/models') return json(res, 200, { object: 'list', data: ['mock-gpt', 'mock-reasoner', 'mock-think-tag', 'mock-error'].map((id) => ({ id, object: 'model' })) });
    if (p === '/v1/chat/completions') {
      const body = await readBody(req);
      const lastMsg = body.messages?.[body.messages.length - 1];
      const images = Array.isArray(lastMsg?.content) ? lastMsg.content.filter((p) => p.type === 'image_url').length : 0;
      log.push({ api: 'openai', images, body: { ...body, messages: body.messages?.length } });
      if (body.model === 'mock-error') return json(res, 400, { error: { message: 'This model is intentionally broken' } });
      const user = lastUserText(body.messages ?? []);
      const text = answerFor(user, body.model, 'Mock Chat Title');
      if (!body.stream) {
        return json(res, 200, { choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 34 } });
      }
      sse(res);
      const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      if (/reasoner/.test(body.model) && !isTitleRequest(user)) {
        const thought = /快速排序/.test(user) ? DEMO_REASONING : 'Let me think about this step by step. The user greeted me, so I should respond warmly.';
        for (const c of chunks(thought, 8)) {
          send({ choices: [{ delta: { reasoning_content: c } }] });
          await sleep(15);
        }
      }
      const content = body.model === 'mock-think-tag' ? `<think>Tag-based reasoning here.</think>\n\n${text}` : text;
      for (const c of chunks(content)) {
        if (res.destroyed) return;
        send({ choices: [{ delta: { content: c } }] });
        await sleep(12);
      }
      send({ choices: [{ delta: {}, finish_reason: 'stop' }] });
      send({ choices: [], usage: { prompt_tokens: 42, completion_tokens: 128 } });
      res.write('data: [DONE]\n\n');
      return res.end();
    }
  }

  // ---------- Anthropic ----------
  if (p.startsWith('/anthropic/v1/')) {
    if (req.headers['x-api-key'] !== 'sk-ant-mock') return json(res, 401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
    if (!req.headers['anthropic-version']) return json(res, 400, { type: 'error', error: { type: 'invalid_request_error', message: 'anthropic-version header is required' } });
    if (p === '/anthropic/v1/models') return json(res, 200, { data: [{ id: 'claude-mock-5-5', display_name: 'Claude Mock' }], has_more: false });
    if (p === '/anthropic/v1/messages') {
      const body = await readBody(req);
      log.push({ api: 'anthropic', body: { ...body, messages: body.messages?.length } });
      const user = lastUserText(body.messages ?? []);
      const text = answerFor(user, body.model, 'Claude Title');
      sse(res);
      const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      ev('message_start', { message: { id: 'msg_1', usage: { input_tokens: 25, output_tokens: 1 } } });
      let idx = 0;
      if (body.thinking && body.thinking.type !== 'disabled') {
        ev('content_block_start', { index: idx, content_block: { type: 'thinking', thinking: '' } });
        for (const c of chunks('Considering how Claude should answer this greeting.', 8)) {
          ev('content_block_delta', { index: idx, delta: { type: 'thinking_delta', thinking: c } });
          await sleep(12);
        }
        ev('content_block_stop', { index: idx++ });
      }
      ev('content_block_start', { index: idx, content_block: { type: 'text', text: '' } });
      for (const c of chunks(text)) {
        if (res.destroyed) return;
        ev('content_block_delta', { index: idx, delta: { type: 'text_delta', text: c } });
        await sleep(12);
      }
      ev('content_block_stop', { index: idx });
      ev('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 99 } });
      ev('message_stop', {});
      return res.end();
    }
  }

  // ---------- Gemini ----------
  if (p.startsWith('/gemini/v1beta/')) {
    if (req.headers['x-goog-api-key'] !== 'gm-mock') return json(res, 400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } });
    if (p === '/gemini/v1beta/models')
      return json(res, 200, { models: [{ name: 'models/gemini-mock-2.5-flash', displayName: 'Gemini Mock', supportedGenerationMethods: ['generateContent'] }] });
    const m = /\/models\/([^:]+):(streamGenerateContent|generateContent)/.exec(p);
    if (m) {
      const body = await readBody(req);
      log.push({ api: 'gemini', model: m[1], body: { ...body, contents: body.contents?.length } });
      const user = lastUserText(body.contents ?? []);
      const text = answerFor(user, m[1], 'Gemini Title');
      sse(res);
      const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      if (body.generationConfig?.thinkingConfig?.includeThoughts) {
        send({ candidates: [{ content: { role: 'model', parts: [{ text: 'Gemini is thinking about the request.', thought: true }] } }] });
        await sleep(20);
      }
      for (const c of chunks(text, 20)) {
        if (res.destroyed) return;
        send({ candidates: [{ content: { role: 'model', parts: [{ text: c }] } }] });
        await sleep(15);
      }
      send({ candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 80, thoughtsTokenCount: 10 } });
      return res.end();
    }
  }

  json(res, 404, { error: { message: `mock: no route for ${p}` } });
});

server.listen(port, '127.0.0.1', () => console.log(`[mock-ai] listening on http://127.0.0.1:${port}`));
