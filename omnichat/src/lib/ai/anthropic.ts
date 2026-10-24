// Anthropic Messages API (Claude), also offered by several vendors as an "Anthropic-compatible" endpoint.
import { claudeInfo } from './capabilities';
import { readSSE } from './sse';
import {
  embeddedError,
  JSON_HEADERS,
  mergeExtra,
  providerFetch,
  readError,
  userText,
  type ChatRequest,
  type ChatResult,
  type ChatTurn,
} from './transport';
import { splitDataUrl } from '../utils';
import type { ModelInfo, Provider, Source, Usage } from '../types';
import { searchMode } from './search';

const BUDGETS: Record<string, number> = { minimal: 1024, low: 2048, medium: 8192, high: 16384, xhigh: 32000, max: 32000 };
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

function buildMessages(turns: ChatTurn[]) {
  const out: { role: 'user' | 'assistant'; content: Record<string, unknown>[] }[] = [];
  for (const m of turns) {
    const blocks: Record<string, unknown>[] = [];
    if (m.role === 'user') {
      for (const a of m.attachments ?? []) {
        if (!a.dataUrl) continue;
        const { mime, data } = splitDataUrl(a.dataUrl);
        if (a.kind === 'image' && IMAGE_TYPES.includes(mime)) blocks.push({ type: 'image', source: { type: 'base64', media_type: mime, data } });
        else if (a.kind === 'pdf') blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } });
      }
      const text = userText(m);
      if (text) blocks.push({ type: 'text', text });
    } else if (m.content) {
      blocks.push({ type: 'text', text: m.content });
    }
    if (!blocks.length) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content.push(...blocks);
    else out.push({ role: m.role, content: blocks });
  }
  if (out[0]?.role === 'assistant') out.unshift({ role: 'user', content: [{ type: 'text', text: '(continue)' }] });
  return out;
}

export async function anthropicChat(req: ChatRequest): Promise<ChatResult> {
  const { provider: p, params } = req;
  const info = claudeInfo(req.model);
  const effort = params.reasoningEffort ?? 'default';
  const stream = params.stream !== false;
  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: params.maxTokens || (info.adaptive ? 32000 : info.legacyMaxTokens),
    messages: buildMessages(req.messages),
    stream,
  };
  if (req.system) body.system = req.system;

  let thinking = false;
  if (info.adaptive) {
    if (effort === 'none') {
      if (info.canDisable) body.thinking = { type: 'disabled' };
      else body.output_config = { effort: 'low' };
    } else {
      body.thinking = { type: 'adaptive', display: 'summarized' };
      thinking = true;
      if (effort !== 'default') body.output_config = { effort: effort === 'minimal' ? 'low' : effort };
    }
  } else if (effort !== 'default' && effort !== 'none') {
    const budget = BUDGETS[effort] ?? 8192;
    body.thinking = { type: 'enabled', budget_tokens: budget };
    body.max_tokens = Math.max(Number(body.max_tokens), budget + 4096);
    thinking = true;
  }
  if (params.webSearch && searchMode(p, req.model) === 'anthropic') {
    body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }];
  }
  if (!thinking && info.sampling) {
    if (params.temperature !== undefined) body.temperature = Math.min(1, params.temperature);
    else if (params.topP !== undefined) body.top_p = params.topP;
  }
  mergeExtra(body, p.extraBody, params.extraBody);

  const res = await providerFetch(p, '/messages', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
    signal: req.signal,
  });
  if (!res.ok) throw await readError(res);

  const usage: Usage = {};
  const ct = res.headers.get('content-type') ?? '';
  if (!stream || ct.includes('application/json')) {
    const j = await res.json();
    const err = embeddedError(j);
    if (err) throw err;
    for (const b of j.content ?? []) {
      if (b.type === 'thinking' && b.thinking) req.onDelta({ reasoning: b.thinking });
      else if (b.type === 'text' && b.text) req.onDelta({ content: b.text });
      else if (b.type === 'web_search_tool_result') req.onDelta({ sources: resultSources(b) });
    }
    return {
      usage: { input: j.usage?.input_tokens, output: j.usage?.output_tokens, cached: j.usage?.cache_read_input_tokens },
      finishReason: j.stop_reason,
    };
  }

  let finishReason: string | undefined;
  const toolInput = new Map<number, string>();
  for await (const ev of readSSE(res)) {
    let j: any;
    try {
      j = JSON.parse(ev.data);
    } catch {
      continue;
    }
    switch (j.type) {
      case 'message_start': {
        const u = j.message?.usage ?? {};
        usage.input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
        usage.cached = u.cache_read_input_tokens;
        usage.output = u.output_tokens;
        break;
      }
      case 'content_block_start': {
        const b = j.content_block ?? {};
        if (b.type === 'thinking' && b.thinking) req.onDelta({ reasoning: b.thinking });
        else if (b.type === 'text' && b.text) req.onDelta({ content: b.text });
        else if (b.type === 'server_tool_use') toolInput.set(j.index, '');
        else if (b.type === 'web_search_tool_result') req.onDelta({ sources: resultSources(b) });
        break;
      }
      case 'content_block_delta': {
        const d = j.delta ?? {};
        if (d.type === 'text_delta' && d.text) req.onDelta({ content: d.text });
        else if (d.type === 'thinking_delta' && d.thinking) req.onDelta({ reasoning: d.thinking });
        else if (d.type === 'input_json_delta' && toolInput.has(j.index)) toolInput.set(j.index, toolInput.get(j.index)! + (d.partial_json ?? ''));
        else if (d.type === 'citations_delta' && d.citation?.url) req.onDelta({ sources: [{ url: d.citation.url, title: d.citation.title }] });
        break;
      }
      case 'content_block_stop': {
        const input = toolInput.get(j.index);
        if (input !== undefined) {
          toolInput.delete(j.index);
          try {
            const q = JSON.parse(input || '{}').query;
            if (q) req.onDelta({ searching: String(q) });
          } catch {
            /* partial input */
          }
        }
        break;
      }
      case 'message_delta':
        if (j.usage?.output_tokens !== undefined) usage.output = j.usage.output_tokens;
        if (j.delta?.stop_reason) finishReason = j.delta.stop_reason;
        break;
      case 'error':
        throw embeddedError(j) ?? new Error('Stream error');
      default:
        break;
    }
  }
  return { usage, finishReason };
}

function resultSources(block: any): Source[] {
  const list = Array.isArray(block.content) ? block.content : [];
  return list.filter((r: any) => r?.url).map((r: any) => ({ url: String(r.url), title: r.title ? String(r.title) : undefined }));
}

export async function anthropicModels(p: Provider): Promise<ModelInfo[]> {
  const res = await providerFetch(p, '/models?limit=1000', { method: 'GET' });
  if (!res.ok) throw await readError(res);
  const j = await res.json();
  return (j.data ?? []).map((m: any) => ({ id: String(m.id), name: m.display_name || undefined }));
}
