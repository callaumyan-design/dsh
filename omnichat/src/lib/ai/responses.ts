// OpenAI Responses API (/responses): reasoning summaries, built-in web search, models only offered there.
import { guessReasoning } from './capabilities';
import { readSSE } from './sse';
import {
  embeddedError,
  JSON_HEADERS,
  mergeExtra,
  providerFetch,
  ProviderError,
  readError,
  userText,
  type ChatRequest,
  type ChatResult,
} from './transport';
import type { Source, Usage } from '../types';

function buildInput(req: ChatRequest) {
  return req.messages
    .map((m) => {
      if (m.role === 'assistant') return m.content ? { role: 'assistant', content: m.content } : null;
      const atts = m.attachments ?? [];
      const text = userText(m);
      const media = atts.filter((a) => (a.kind === 'image' || a.kind === 'pdf') && a.dataUrl);
      if (!media.length) return { role: 'user', content: text };
      const parts: Record<string, unknown>[] = [];
      for (const a of media) {
        if (a.kind === 'image') parts.push({ type: 'input_image', image_url: a.dataUrl });
        else parts.push({ type: 'input_file', filename: a.name, file_data: a.dataUrl });
      }
      if (text) parts.push({ type: 'input_text', text });
      return { role: 'user', content: parts };
    })
    .filter(Boolean);
}

function mapUsage(u: any): Usage | undefined {
  if (!u) return undefined;
  return {
    input: u.input_tokens,
    output: u.output_tokens,
    reasoning: u.output_tokens_details?.reasoning_tokens,
    cached: u.input_tokens_details?.cached_tokens,
  };
}

function citation(a: any): Source | null {
  return a?.type === 'url_citation' && a.url ? { url: String(a.url), title: a.title ? String(a.title) : undefined } : null;
}

export async function responsesChat(req: ChatRequest): Promise<ChatResult> {
  const { provider: p, params } = req;
  const stream = params.stream !== false;
  const effort = params.reasoningEffort ?? 'default';

  const build = (withSummary: boolean) => {
    const body: Record<string, unknown> = { model: req.model, input: buildInput(req), stream, store: false };
    if (req.system) body.instructions = req.system;
    if (params.maxTokens) body.max_output_tokens = params.maxTokens;
    if (params.temperature !== undefined) body.temperature = params.temperature;
    if (params.topP !== undefined) body.top_p = params.topP;
    const reasoning: Record<string, unknown> = {};
    if (effort !== 'default') reasoning.effort = effort === 'max' ? 'xhigh' : effort;
    if (withSummary && effort !== 'none') reasoning.summary = 'auto';
    if (Object.keys(reasoning).length) body.reasoning = reasoning;
    if (params.webSearch) body.tools = [{ type: 'web_search' }];
    mergeExtra(body, p.extraBody, params.extraBody);
    return body;
  };

  const send = (body: Record<string, unknown>) =>
    providerFetch(p, '/responses', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body), signal: req.signal });

  // Reasoning summaries need a reasoning model (and, on some accounts, a verified organization).
  const wantSummary = guessReasoning(req.model);
  let res = await send(build(wantSummary));
  if (!res.ok && wantSummary && res.status === 400) {
    const err = await readError(res);
    if (!/summar|verif|reasoning/i.test(err.message)) throw err;
    res = await send(build(false));
  }
  if (!res.ok) throw await readError(res);

  let usage: Usage | undefined;
  let finishReason: string | undefined;
  const finish = (r: any) => {
    usage = mapUsage(r?.usage) ?? usage;
    if (r?.status === 'incomplete') finishReason = r.incomplete_details?.reason === 'max_output_tokens' ? 'length' : r.incomplete_details?.reason;
    else if (r?.status === 'completed') finishReason = 'stop';
  };

  const ct = res.headers.get('content-type') ?? '';
  if (!stream || ct.includes('application/json')) {
    const j = await res.json();
    const err = embeddedError(j);
    if (err && !j.output) throw err;
    for (const item of j.output ?? []) {
      if (item.type === 'reasoning') {
        const text = (item.summary ?? []).map((s: any) => s.text ?? '').join('\n\n');
        if (text) req.onDelta({ reasoning: text });
      } else if (item.type === 'message') {
        for (const c of item.content ?? []) {
          if (c.type === 'output_text' && c.text) req.onDelta({ content: c.text });
          const sources = (c.annotations ?? []).map(citation).filter(Boolean) as Source[];
          if (sources.length) req.onDelta({ sources });
        }
      }
    }
    finish(j);
    return { usage, finishReason };
  }

  let summaryParts = 0;
  for await (const ev of readSSE(res)) {
    let j: any;
    try {
      j = JSON.parse(ev.data);
    } catch {
      continue;
    }
    switch (j.type ?? ev.event) {
      case 'response.output_text.delta':
        if (j.delta) req.onDelta({ content: j.delta });
        break;
      case 'response.reasoning_summary_text.delta':
        if (j.delta) req.onDelta({ reasoning: j.delta });
        break;
      case 'response.reasoning_summary_part.added':
        if (summaryParts++ > 0) req.onDelta({ reasoning: '\n\n' });
        break;
      case 'response.output_text.annotation.added': {
        const s = citation(j.annotation);
        if (s) req.onDelta({ sources: [s] });
        break;
      }
      case 'response.output_item.added':
        if (j.item?.type === 'web_search_call' && j.item.action?.query) req.onDelta({ searching: String(j.item.action.query) });
        break;
      case 'response.output_item.done':
        if (j.item?.type === 'web_search_call' && j.item.action?.query) req.onDelta({ searching: String(j.item.action.query) });
        break;
      case 'response.completed':
      case 'response.incomplete':
        finish(j.response);
        break;
      case 'response.failed':
        throw new ProviderError(j.response?.error?.message ?? 'Response failed');
      case 'error':
        throw new ProviderError(j.message ?? j.error?.message ?? 'Stream error');
      default:
        break;
    }
  }
  return { usage, finishReason };
}
