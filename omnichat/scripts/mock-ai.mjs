// A tiny mock of the OpenAI, Anthropic and Gemini streaming APIs for local testing.
//   node scripts/mock-ai.mjs [port]
// OpenAI:    http://127.0.0.1:PORT/v1            (key: sk-mock)
// Anthropic: http://127.0.0.1:PORT/anthropic/v1  (key: sk-ant-mock)
// Gemini:    http://127.0.0.1:PORT/gemini/v1beta (key: gm-mock)
// Image and video generation: OpenAI /images/*, /videos, the relay task API /video/generations,
// Gemini image models (inlineData), Imagen (:predict) and Veo (:predictLongRunning).
import http from 'node:http';
import zlib from 'node:zlib';

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

const SEARCH_RESULTS = [
  { title: 'OmniChat on GitHub', url: 'https://github.com/callaumyan-design/dsh' },
  { title: 'Chatbot - Wikipedia', url: 'https://en.wikipedia.org/wiki/Chatbot' },
];

function wantsSearch(body) {
  return !!(
    body.enable_search ||
    body.web_search_options ||
    body.enable_enhancement ||
    body.web_search?.enable ||
    (body.plugins ?? []).some((p) => p.id === 'web') ||
    (body.tools ?? []).some((t) => t.type === 'web_search' || t.name === 'web_search' || t.google_search)
  );
}

// ---------- Generated media ----------

/** A solid-colour PNG (valid, so browsers render it). */
function png(w, h, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3).map((_, i) => [r, g, b][i % 3])]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const COLORS = [
  [91, 91, 214],
  [16, 163, 127],
  [217, 119, 87],
  [66, 133, 244],
];
const sizeOf = (s, fallback = [64, 64]) => {
  const m = /^(\d+)[x*](\d+)$/.exec(s ?? '');
  return m ? [Math.max(8, Math.round(Number(m[1]) / 16)), Math.max(8, Math.round(Number(m[2]) / 16))] : fallback;
};
const imageB64 = (i = 0, size) => png(...sizeOf(size), COLORS[i % COLORS.length]).toString('base64');

// A one-second 64x36 H.264 clip.
const MP4 = Buffer.from('AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAANFbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAm90cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAEAAAAAkAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAHnbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAQABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABkm1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAVJzdGJsAAAAunN0c2QAAAAAAAAAAQAAAKphdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAEAAJABIAAAASAAAAAAAAAABFUxhdmM2MC4zMS4xMDIgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAAMGF2Y0MBQsAK/+EAGGdCwArZBH+fARAAAAMAEAAAAwEA8SJkgAEABWjLg8sgAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAAFtgAABbYAAAAGHN0dHMAAAAAAAAAAQAAAAgAAAgAAAAAFHN0c3MAAAAAAAAAAQAAAAEAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAgAAAABAAAANHN0c3oAAAAAAAAAAAAAAAgAAAKVAAAACgAAAAoAAAAKAAAACgAAAAoAAAAKAAAACgAAABRzdGNvAAAAAAAAAAEAAAN1AAAAYnVkdGEAAABabWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAtaWxzdAAAACWpdG9vAAAAHWRhdGEAAAABAAAAAExhdmY2MC4xNi4xMDAAAAAIZnJlZQAAAuNtZGF0AAACcAYF//9s3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NCByMzEwOCAzMWUxOWY5IC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyMyAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTAgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MToweDExMSBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MCBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0wIHdlaWdodHA9MCBrZXlpbnQ9MjUwIGtleWludF9taW49OCBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTQwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAAB1liIQEPEYoAAjvxwABLYjgACCzJycnXXXXXXXXgAAAAAZBmjgIeNgAAAAGQZpUAh42AAAABkGaYBDxsAAAAAZBmoAQ8bAAAAAGQZqgP8bAAAAABkGawD/GwAAAAAZBmuA7xsA=', 'base64');

/** Video jobs: each poll moves a job forward; it completes on the third. */
const videoJobs = new Map();
function pollJob(id) {
  const job = videoJobs.get(id);
  if (!job) return null;
  job.polls++;
  return job;
}

async function readRaw(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

/** Text fields and file count of a multipart/form-data body. */
function parseMultipart(buf, contentType) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType ?? '');
  const fields = {};
  let files = 0;
  if (!boundary) return { fields, files };
  const sep = `--${boundary[1] ?? boundary[2]}`;
  for (const part of buf.toString('latin1').split(sep)) {
    const name = /name="([^"]+)"/.exec(part)?.[1];
    if (!name) continue;
    if (/filename="/.test(part)) files++;
    else fields[name] = part.slice(part.indexOf('\r\n\r\n') + 4).replace(/\r\n$/, '');
  }
  return { fields, files };
}

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
  // Provider CDN links: no key needed.
  if (p.startsWith('/files/')) {
    if (p.endsWith('.mp4')) {
      res.writeHead(200, { 'content-type': 'video/mp4' });
      return res.end(MP4);
    }
    res.writeHead(200, { 'content-type': 'image/png' });
    return res.end(png(...sizeOf(url.searchParams.get('size')), COLORS[3]));
  }

  // ---------- OpenAI ----------
  if (p.startsWith('/v1/')) {
    if (req.headers.authorization !== 'Bearer sk-mock') return json(res, 401, { error: { message: 'Incorrect API key provided', type: 'invalid_request_error' } });
    if (p === '/v1/models')
      return json(res, 200, {
        object: 'list',
        data: ['mock-gpt', 'mock-reasoner', 'mock-think-tag', 'mock-error', 'mock-slow', 'gpt-image-1', 'sora-2'].map((id) => ({ id, object: 'model' })),
      });
    if (p === '/v1/images/generations' || p === '/v1/images/edits') {
      let body;
      let files = 0;
      if (p.endsWith('edits')) {
        const mp = parseMultipart(await readRaw(req), req.headers['content-type']);
        body = mp.fields;
        files = mp.files;
      } else body = await readBody(req);
      log.push({ api: 'images', path: p, model: body.model, prompt: body.prompt, size: body.size, n: body.n, quality: body.quality, files });
      if (/fail/.test(body.prompt ?? '')) return json(res, 400, { error: { message: 'Your request was rejected by the safety system.' } });
      await sleep(300);
      const n = Math.max(1, Number(body.n) || 1);
      // "url-image" models answer with links (like Ark, Zhipu and SiliconFlow), the rest with base64.
      const data = Array.from({ length: n }, (_, i) =>
        /url-image/.test(body.model) ? { url: `http://127.0.0.1:${port}/files/image-${i}.png?size=${body.size ?? ''}` } : { b64_json: imageB64(i, body.size), revised_prompt: `A refined prompt: ${body.prompt}` },
      );
      return json(res, 200, { created: Date.now(), data, usage: { input_tokens: 15, output_tokens: 272 * n } });
    }
    if (p === '/v1/videos' && req.method === 'POST') {
      const { fields, files } = parseMultipart(await readRaw(req), req.headers['content-type']);
      log.push({ api: 'videos', model: fields.model, prompt: fields.prompt, seconds: fields.seconds, size: fields.size, files });
      if (/relay/.test(fields.model ?? '')) return json(res, 404, { error: { message: 'Invalid URL (POST /v1/videos)' } });
      const id = `video_${Math.random().toString(36).slice(2, 10)}`;
      videoJobs.set(id, { polls: 0, prompt: fields.prompt });
      return json(res, 200, { id, object: 'video', status: 'queued', progress: 0, model: fields.model });
    }
    const vid = /^\/v1\/videos\/([^/]+)(\/content)?$/.exec(p);
    if (vid) {
      if (vid[2]) {
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': MP4.length });
        return res.end(MP4);
      }
      const job = pollJob(vid[1]);
      if (!job) return json(res, 404, { error: { message: 'Video not found' } });
      if (/fail/.test(job.prompt ?? '') && job.polls >= 2) return json(res, 200, { id: vid[1], status: 'failed', error: { message: 'Video blocked by moderation' } });
      const status = job.polls >= 3 ? 'completed' : job.polls >= 2 ? 'in_progress' : 'queued';
      return json(res, 200, { id: vid[1], object: 'video', status, progress: status === 'completed' ? 100 : job.polls * 30 });
    }
    // The task API of relays (new-api style).
    if (p === '/v1/video/generations' && req.method === 'POST') {
      const body = await readBody(req);
      log.push({ api: 'video-relay', model: body.model, prompt: body.prompt, duration: body.duration, aspect: body.aspect_ratio });
      const id = `task_${Math.random().toString(36).slice(2, 10)}`;
      videoJobs.set(id, { polls: 0, prompt: body.prompt });
      return json(res, 200, { task_id: id, status: 'submitted' });
    }
    const task = /^\/v1\/video\/generations\/([^/]+)$/.exec(p);
    if (task) {
      const job = pollJob(task[1]);
      if (!job) return json(res, 404, { error: { message: 'Task not found' } });
      const done = job.polls >= 3;
      return json(res, 200, { task_id: task[1], status: done ? 'succeeded' : 'in_progress', progress: `${Math.min(100, job.polls * 33)}%`, url: done ? `http://127.0.0.1:${port}/files/clip.mp4` : undefined });
    }
    if (p === '/v1/responses') {
      const body = await readBody(req);
      log.push({ api: 'responses', search: (body.tools ?? []).some((t) => t.type === 'web_search'), reasoning: body.reasoning, model: body.model });
      if (body.reasoning?.summary && /nosummary/.test(body.model)) {
        return json(res, 400, { error: { message: 'Your organization must be verified to generate reasoning summaries.' } });
      }
      const input = body.input ?? [];
      const last = [...input].reverse().find((m) => m.role === 'user');
      const user = typeof last?.content === 'string' ? last.content : (last?.content ?? []).map((c) => c.text).filter(Boolean).join(' ');
      const text = answerFor(user, body.model, 'Responses Title');
      sse(res);
      const ev = (type, data = {}) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      ev('response.created', { response: { id: 'resp_1', status: 'in_progress' } });
      if (body.reasoning?.summary) {
        ev('response.reasoning_summary_part.added', {});
        for (const c of chunks('**Planning** I will answer the greeting concisely.', 8)) {
          ev('response.reasoning_summary_text.delta', { delta: c });
          await sleep(10);
        }
      }
      if ((body.tools ?? []).some((t) => t.type === 'web_search')) {
        ev('response.output_item.added', { item: { type: 'web_search_call', action: { query: user } } });
      }
      for (const c of chunks(text)) {
        if (res.destroyed) return;
        ev('response.output_text.delta', { delta: c });
        await sleep(10);
      }
      if ((body.tools ?? []).some((t) => t.type === 'web_search')) {
        for (const r of SEARCH_RESULTS) ev('response.output_text.annotation.added', { annotation: { type: 'url_citation', ...r } });
      }
      ev('response.completed', { response: { status: 'completed', usage: { input_tokens: 21, output_tokens: 77, output_tokens_details: { reasoning_tokens: 12 } } } });
      return res.end();
    }
    if (p === '/v1/chat/completions') {
      const body = await readBody(req);
      const lastMsg = body.messages?.[body.messages.length - 1];
      const images = Array.isArray(lastMsg?.content) ? lastMsg.content.filter((p) => p.type === 'image_url').length : 0;
      const system = body.messages?.find((m) => m.role === 'system')?.content;
      log.push({ api: 'openai', images, system, search: wantsSearch(body), body: { ...body, messages: body.messages?.length } });
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
      if (wantsSearch(body)) send({ choices: [{ delta: {} }], search_info: { search_results: SEARCH_RESULTS } });
      const content = body.model === 'mock-think-tag' ? `<think>Tag-based reasoning here.</think>\n\n${text}` : text;
      // mock-slow streams slowly, for tests that act while a reply is still being generated.
      const pace = body.model === 'mock-slow' ? 150 : 12;
      for (const c of chunks(content)) {
        if (res.destroyed) return;
        send({ choices: [{ delta: { content: c } }] });
        await sleep(pace);
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
      log.push({ api: 'anthropic', search: wantsSearch(body), body: { ...body, messages: body.messages?.length } });
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
      if (wantsSearch(body)) {
        ev('content_block_start', { index: idx, content_block: { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: {} } });
        ev('content_block_delta', { index: idx, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ query: user }) } });
        ev('content_block_stop', { index: idx++ });
        ev('content_block_start', {
          index: idx,
          content_block: { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: SEARCH_RESULTS.map((r) => ({ type: 'web_search_result', ...r })) },
        });
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
      return json(res, 200, {
        models: [
          { name: 'models/gemini-mock-2.5-flash', displayName: 'Gemini Mock', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-2.5-flash-image', displayName: 'Nano Banana', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/imagen-4.0-generate-001', displayName: 'Imagen 4', supportedGenerationMethods: ['predict'] },
          { name: 'models/veo-3.0-generate-001', displayName: 'Veo 3', supportedGenerationMethods: ['predictLongRunning'] },
          { name: 'models/text-embedding-004', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] },
        ],
      });
    const predict = /\/models\/([^:]+):(predict|predictLongRunning)$/.exec(p);
    if (predict) {
      const body = await readBody(req);
      log.push({ api: predict[2], model: predict[1], prompt: body.instances?.[0]?.prompt, image: !!body.instances?.[0]?.image, parameters: body.parameters });
      if (predict[2] === 'predict') {
        const n = body.parameters?.sampleCount ?? 1;
        return json(res, 200, { predictions: Array.from({ length: n }, (_, i) => ({ bytesBase64Encoded: imageB64(i + 1), mimeType: 'image/png' })) });
      }
      const id = `op${Math.random().toString(36).slice(2, 10)}`;
      videoJobs.set(id, { polls: 0, prompt: body.instances?.[0]?.prompt });
      return json(res, 200, { name: `models/${predict[1]}/operations/${id}` });
    }
    const op = /\/models\/([^/]+)\/operations\/([^/]+)$/.exec(p);
    if (op) {
      const job = pollJob(op[2]);
      if (!job) return json(res, 404, { error: { message: 'Operation not found' } });
      if (job.polls < 3) return json(res, 200, { name: `models/${op[1]}/operations/${op[2]}` });
      return json(res, 200, {
        name: `models/${op[1]}/operations/${op[2]}`,
        done: true,
        response: { generateVideoResponse: { generatedSamples: [{ video: { uri: `http://127.0.0.1:${port}/gemini/v1beta/files/${op[2]}:download?alt=media` } }] } },
      });
    }
    if (/\/files\/[^/]+:download$/.test(p)) {
      res.writeHead(200, { 'content-type': 'video/mp4' });
      return res.end(MP4);
    }
    const m = /\/models\/([^:]+):(streamGenerateContent|generateContent)/.exec(p);
    if (m) {
      const body = await readBody(req);
      log.push({ api: 'gemini', model: m[1], search: wantsSearch(body), body: { ...body, contents: body.contents?.length } });
      const user = lastUserText(body.contents ?? []);
      const text = answerFor(user, m[1], 'Gemini Title');
      sse(res);
      const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      if (/image/.test(m[1])) {
        // Image models: a line of text, then the image; earlier images come back in model turns for editing.
        const priorImages = (body.contents ?? []).filter((c) => c.role === 'model').flatMap((c) => c.parts ?? []).filter((x) => x.inlineData).length;
        log[log.length - 1].modalities = body.generationConfig?.responseModalities;
        log[log.length - 1].priorImages = priorImages;
        log[log.length - 1].aspect = body.generationConfig?.imageConfig?.aspectRatio;
        send({ candidates: [{ content: { role: 'model', parts: [{ text: 'Here is your picture.' }] } }] });
        await sleep(200);
        send({ candidates: [{ content: { role: 'model', parts: [{ inlineData: { mimeType: 'image/png', data: imageB64(priorImages + 2) } }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 1290 } });
        return res.end();
      }
      if (body.generationConfig?.thinkingConfig?.includeThoughts) {
        send({ candidates: [{ content: { role: 'model', parts: [{ text: 'Gemini is thinking about the request.', thought: true }] } }] });
        await sleep(20);
      }
      for (const c of chunks(text, 20)) {
        if (res.destroyed) return;
        send({ candidates: [{ content: { role: 'model', parts: [{ text: c }] } }] });
        await sleep(15);
      }
      const grounding = wantsSearch(body)
        ? { groundingMetadata: { webSearchQueries: [user], groundingChunks: SEARCH_RESULTS.map((r) => ({ web: { uri: r.url, title: r.title } })) } }
        : {};
      send({ candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'STOP', ...grounding }], usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 80, thoughtsTokenCount: 10 } });
      return res.end();
    }
  }

  json(res, 404, { error: { message: `mock: no route for ${p}` } });
});

const host = process.env.MOCK_HOST || '127.0.0.1';
server.listen(port, host, () => console.log(`[mock-ai] listening on http://${host}:${port}`));
