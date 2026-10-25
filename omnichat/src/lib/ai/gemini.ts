// Google Gemini (Generative Language API, v1beta).
import { geminiThinkingStyle } from './capabilities';
import { searchMode } from './search';
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
import { splitDataUrl } from '../utils';
import type { ModelInfo, Provider, ReasoningEffort, Usage } from '../types';

function thinkingConfig(model: string, effort: ReasoningEffort): Record<string, unknown> | undefined {
  const style = geminiThinkingStyle(model);
  if (style === 'none') return undefined;
  const isPro = /pro/i.test(model);
  if (style === 'level') {
    if (effort === 'default') return { includeThoughts: true };
    if (effort === 'none' || effort === 'minimal' || effort === 'low') return { thinkingLevel: 'low', includeThoughts: effort !== 'none' };
    return { thinkingLevel: 'high', includeThoughts: true };
  }
  switch (effort) {
    case 'default':
      return { includeThoughts: true };
    case 'none':
      return isPro ? { thinkingBudget: 128 } : { thinkingBudget: 0 };
    case 'minimal':
    case 'low':
      return { thinkingBudget: 1024, includeThoughts: true };
    case 'medium':
      return { thinkingBudget: 8192, includeThoughts: true };
    case 'high':
      return { thinkingBudget: 24576, includeThoughts: true };
    default:
      return { thinkingBudget: -1, includeThoughts: true };
  }
}

function buildContents(req: ChatRequest) {
  const out: { role: 'user' | 'model'; parts: Record<string, unknown>[] }[] = [];
  for (const m of req.messages) {
    const parts: Record<string, unknown>[] = [];
    if (m.role === 'user') {
      for (const a of m.attachments ?? []) {
        if (!a.dataUrl || (a.kind !== 'image' && a.kind !== 'pdf')) continue;
        const { mime, data } = splitDataUrl(a.dataUrl);
        parts.push({ inlineData: { mimeType: mime, data } });
      }
      const text = userText(m);
      if (text) parts.push({ text });
    } else if (m.content) {
      parts.push({ text: m.content });
    }
    if (!parts.length) continue;
    const role = m.role === 'assistant' ? 'model' : 'user';
    const last = out[out.length - 1];
    if (last && last.role === role) last.parts.push(...parts);
    else out.push({ role, parts });
  }
  return out;
}

function mapUsage(u: any): Usage | undefined {
  if (!u) return undefined;
  return {
    input: u.promptTokenCount,
    output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) || undefined,
    reasoning: u.thoughtsTokenCount,
    cached: u.cachedContentTokenCount,
  };
}

const modelPath = (model: string) => `/models/${model.replace(/^models\//, '')}`;

export async function geminiChat(req: ChatRequest): Promise<ChatResult> {
  const { provider: p, params } = req;
  const stream = params.stream !== false;
  const generationConfig: Record<string, unknown> = {};
  if (params.temperature !== undefined) generationConfig.temperature = params.temperature;
  if (params.topP !== undefined) generationConfig.topP = params.topP;
  if (params.maxTokens) generationConfig.maxOutputTokens = params.maxTokens;
  const tc = thinkingConfig(req.model, params.reasoningEffort ?? 'default');
  if (tc) generationConfig.thinkingConfig = tc;

  const body: Record<string, unknown> = { contents: buildContents(req) };
  if (params.webSearch && searchMode(p, req.model) === 'gemini') body.tools = [{ google_search: {} }];
  if (req.system) body.systemInstruction = { parts: [{ text: req.system }] };
  if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;
  mergeExtra(body, p.extraBody, params.extraBody);

  const path = `${modelPath(req.model)}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
  const res = await providerFetch(p, path, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body), signal: req.signal });
  if (!res.ok) throw await readError(res);

  let usage: Usage | undefined;
  let finishReason: string | undefined;
  const handle = (j: any) => {
    const err = embeddedError(j);
    if (err) throw err;
    if (j.promptFeedback?.blockReason) throw new ProviderError(`Blocked by Gemini: ${j.promptFeedback.blockReason}`);
    const cand = j.candidates?.[0];
    for (const part of cand?.content?.parts ?? []) {
      if (typeof part.text !== 'string' || !part.text) continue;
      if (part.thought) req.onDelta({ reasoning: part.text });
      else req.onDelta({ content: part.text });
    }
    const gm = cand?.groundingMetadata;
    if (gm) {
      const q = gm.webSearchQueries?.[0];
      if (q) req.onDelta({ searching: String(q) });
      const sources = (gm.groundingChunks ?? [])
        .map((c: any) => c?.web)
        .filter((w: any) => w?.uri)
        .map((w: any) => ({ url: String(w.uri), title: w.title ? String(w.title) : undefined }));
      if (sources.length) req.onDelta({ sources });
    }
    if (cand?.finishReason) finishReason = cand.finishReason;
    if (j.usageMetadata) usage = mapUsage(j.usageMetadata);
  };

  const ct = res.headers.get('content-type') ?? '';
  if (!stream || ct.includes('application/json')) {
    const j = await res.json();
    for (const chunk of Array.isArray(j) ? j : [j]) handle(chunk);
  } else {
    for await (const ev of readSSE(res)) {
      let j: any;
      try {
        j = JSON.parse(ev.data);
      } catch {
        continue;
      }
      handle(j);
    }
  }
  const mapped: Record<string, string> = { STOP: 'stop', MAX_TOKENS: 'length', FINISH_REASON_UNSPECIFIED: 'stop' };
  return { usage, finishReason: finishReason ? (mapped[finishReason] ?? finishReason.toLowerCase()) : undefined };
}

export async function geminiModels(p: Provider): Promise<ModelInfo[]> {
  const res = await providerFetch(p, '/models?pageSize=1000', { method: 'GET' });
  if (!res.ok) throw await readError(res);
  const j = await res.json();
  return (j.models ?? [])
    .filter((m: any) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
    .map((m: any) => ({ id: String(m.name).replace(/^models\//, ''), name: m.displayName || undefined }));
}
