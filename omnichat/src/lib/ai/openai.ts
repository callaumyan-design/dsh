// OpenAI Chat Completions protocol — also spoken by DeepSeek, Qwen, Kimi, GLM, Doubao, OpenRouter, Ollama and most others.
import { getQuirks, type ReasoningStyle } from './presets';
import { createThinkParser, readSSE } from './sse';
import { applyOpenAISearch, openAISources, searchMode } from './search';
import {
  embeddedError,
  JSON_HEADERS,
  mergeExtra,
  providerFetch,
  readError,
  userText,
  type ChatRequest,
  type ChatResult,
} from './transport';
import type { ModelInfo, Provider, ReasoningEffort, Usage } from '../types';

function mapUsage(u: Record<string, any> | undefined): Usage | undefined {
  if (!u) return undefined;
  return {
    input: u.prompt_tokens ?? u.input_tokens,
    output: u.completion_tokens ?? u.output_tokens,
    reasoning: u.completion_tokens_details?.reasoning_tokens ?? u.reasoning_tokens,
    cached: u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens,
  };
}

function applyReasoning(body: Record<string, unknown>, effort: ReasoningEffort | undefined, style: ReasoningStyle) {
  if (!effort || effort === 'default') return;
  const capped = effort === 'xhigh' || effort === 'max' ? 'high' : effort;
  switch (style) {
    case 'openai':
      body.reasoning_effort = capped;
      break;
    case 'lmh':
      if (effort !== 'none') body.reasoning_effort = capped === 'minimal' ? 'low' : capped;
      break;
    case 'openrouter':
      body.reasoning = effort === 'none' ? { enabled: false } : { effort: capped === 'minimal' ? 'low' : capped };
      break;
    case 'enable_thinking':
      body.enable_thinking = effort !== 'none';
      break;
    case 'thinking_type':
      body.thinking = { type: effort === 'none' ? 'disabled' : 'enabled' };
      break;
    default:
      break;
  }
}

function buildMessages(req: ChatRequest, pdfSupported: boolean) {
  const out: Record<string, unknown>[] = [];
  if (req.system) out.push({ role: 'system', content: req.system });
  for (const m of req.messages) {
    if (m.role === 'assistant') {
      if (m.content) out.push({ role: 'assistant', content: m.content });
      continue;
    }
    const atts = m.attachments ?? [];
    let text = userText(m);
    const images = atts.filter((a) => a.kind === 'image' && a.dataUrl);
    const pdfs = atts.filter((a) => a.kind === 'pdf' && a.dataUrl);
    if (pdfs.length && !pdfSupported) {
      text = `${pdfs.map((p) => `[PDF attachment "${p.name}" omitted: this provider does not accept PDF files]`).join('\n')}\n\n${text}`;
    }
    if (!images.length && !(pdfs.length && pdfSupported)) {
      out.push({ role: 'user', content: text });
      continue;
    }
    const parts: Record<string, unknown>[] = [];
    if (text) parts.push({ type: 'text', text });
    if (pdfSupported) for (const f of pdfs) parts.push({ type: 'file', file: { filename: f.name, file_data: f.dataUrl } });
    for (const img of images) parts.push({ type: 'image_url', image_url: { url: img.dataUrl } });
    out.push({ role: 'user', content: parts });
  }
  return out;
}

function reasoningOf(delta: Record<string, any>): string | undefined {
  const r = delta.reasoning_content ?? delta.reasoning ?? delta.thinking;
  return typeof r === 'string' && r ? r : undefined;
}

export async function openaiChat(req: ChatRequest): Promise<ChatResult> {
  const { provider: p, params } = req;
  const quirks = getQuirks(p);
  const stream = params.stream !== false;
  const body: Record<string, unknown> = {
    model: req.model,
    messages: buildMessages(req, !!quirks.pdf),
    stream,
  };
  if (stream && quirks.streamUsage !== false) body.stream_options = { include_usage: true };
  if (params.temperature !== undefined) body.temperature = params.temperature;
  if (params.topP !== undefined) body.top_p = params.topP;
  if (params.maxTokens) body[quirks.maxTokensField ?? 'max_tokens'] = params.maxTokens;
  applyReasoning(body, params.reasoningEffort, quirks.reasoning ?? 'openai');
  if (params.webSearch) {
    const mode = searchMode(p, req.model);
    if (mode) applyOpenAISearch(body, mode);
  }
  mergeExtra(body, p.extraBody, params.extraBody);

  const res = await providerFetch(p, '/chat/completions', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
    signal: req.signal,
  });
  if (!res.ok) throw await readError(res);

  const think = createThinkParser(req.onDelta);
  const handleContent = (content: unknown) => {
    if (typeof content === 'string') {
      if (content) think.push(content);
    } else if (Array.isArray(content)) {
      // e.g. Mistral Magistral: [{type:'thinking', thinking:[{text}]}, {type:'text', text}]
      for (const part of content) {
        if (part?.type === 'text' && part.text) think.push(part.text);
        else if (part?.type === 'thinking') {
          const t = Array.isArray(part.thinking) ? part.thinking.map((x: any) => x?.text ?? '').join('') : String(part.thinking ?? '');
          if (t) req.onDelta({ reasoning: t });
        }
      }
    }
  };

  const ct = res.headers.get('content-type') ?? '';
  if (!stream || ct.includes('application/json')) {
    const j = await res.json();
    const err = embeddedError(j);
    if (err && !j.choices) throw err;
    const msg = j.choices?.[0]?.message ?? {};
    const sources = openAISources(j);
    if (sources.length) req.onDelta({ sources });
    const r = reasoningOf(msg);
    if (r) req.onDelta({ reasoning: r });
    handleContent(msg.content);
    think.end();
    return { usage: mapUsage(j.usage), finishReason: j.choices?.[0]?.finish_reason };
  }

  let usage: Usage | undefined;
  let finishReason: string | undefined;
  for await (const ev of readSSE(res)) {
    if (ev.data === '[DONE]') break;
    let j: any;
    try {
      j = JSON.parse(ev.data);
    } catch {
      continue;
    }
    if (!j.choices) {
      const err = embeddedError(j);
      if (err) throw err;
    }
    const sources = openAISources(j);
    if (sources.length) req.onDelta({ sources });
    const choice = j.choices?.[0];
    const delta = choice?.delta ?? choice?.message;
    if (delta) {
      const r = reasoningOf(delta);
      if (r) req.onDelta({ reasoning: r });
      handleContent(delta.content);
    }
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (j.usage) usage = mapUsage(j.usage);
  }
  think.end();
  return { usage, finishReason };
}

export async function openaiModels(p: Provider): Promise<ModelInfo[]> {
  const res = await providerFetch(p, '/models', { method: 'GET' });
  if (!res.ok) throw await readError(res);
  const j = await res.json();
  const list: any[] = Array.isArray(j) ? j : (j.data ?? j.models ?? []);
  return list
    .map((m) => ({ id: String(m.id ?? m.name ?? m.model ?? ''), name: m.name && m.name !== m.id ? String(m.name) : undefined }))
    .filter((m) => m.id);
}
