// Google Gemini (Generative Language API, v1beta).
import { geminiThinkingStyle } from './capabilities';
import { closestAspect, modelOutput, saveOutput, type MediaOutput } from './media';
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
  type ToolCall,
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

function buildContents(req: ChatRequest, imageOut: boolean) {
  const out: { role: 'user' | 'model'; parts: Record<string, unknown>[] }[] = [];
  // Gemini 3 checks thought signatures on images it made; replies from elsewhere carry a documented placeholder.
  const signed = /gemini-[3-9]/i.test(req.model);
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
    } else {
      // Image models see the images they made earlier (loaded inline by ./media.ts), so they can keep editing them.
      const images = imageOut ? (m.media ?? []).filter((x) => x.kind === 'image' && x.dataUrl) : [];
      if (m.content && !(images.length && /^\[Generated /.test(m.content))) parts.push({ text: m.content });
      for (const img of images) {
        const { mime, data } = splitDataUrl(img.dataUrl!);
        parts.push({
          inlineData: { mimeType: mime, data },
          ...(signed ? { thoughtSignature: img.signature || 'skip_thought_signature_validator' } : {}),
        });
      }
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
  const imageOut = modelOutput(p, req.model) === 'image';
  const generationConfig: Record<string, unknown> = {};
  if (params.temperature !== undefined) generationConfig.temperature = params.temperature;
  if (params.topP !== undefined) generationConfig.topP = params.topP;
  if (params.maxTokens) generationConfig.maxOutputTokens = params.maxTokens;
  if (imageOut) {
    // Image models: ask for images, and leave thinking to the model (several of them reject thinkingConfig).
    generationConfig.responseModalities = ['TEXT', 'IMAGE'];
    const aspect = params.media?.aspect;
    if (aspect) generationConfig.imageConfig = { aspectRatio: closestAspect(aspect, ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9']) };
  } else {
    const tc = thinkingConfig(req.model, params.reasoningEffort ?? 'default');
    if (tc) generationConfig.thinkingConfig = tc;
  }

  const contents: Record<string, unknown>[] = buildContents(req, imageOut);
  for (const r of req.toolRounds ?? []) {
    contents.push({ role: 'model', parts: r.assistant });
    contents.push({
      role: 'user',
      parts: r.results.map((x) => ({
        // Ids starting with "gemini-" were made up here for calls that came without one.
        functionResponse: { ...(x.id.startsWith('gemini-') ? {} : { id: x.id }), name: x.name, response: { content: x.content } },
      })),
    });
  }
  const body: Record<string, unknown> = { contents };
  if (params.webSearch && !imageOut && searchMode(p, req.model) === 'gemini') body.tools = [{ google_search: {} }];
  if (req.tools?.length) {
    body.tools = [...((body.tools as unknown[]) ?? []), { functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }];
    if (req.toolChoice === 'none') body.toolConfig = { functionCallingConfig: { mode: 'NONE' } };
  }
  if (req.system) body.systemInstruction = { parts: [{ text: req.system }] };
  if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;
  mergeExtra(body, p.extraBody, params.extraBody);

  const path = `${modelPath(req.model)}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
  const res = await providerFetch(p, path, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body), signal: req.signal }, req.fetch);
  if (!res.ok) throw await readError(res);

  let usage: Usage | undefined;
  let finishReason: string | undefined;
  // This turn's parts as received (Gemini 3 needs their thought signatures back with function calls).
  const parts: any[] = [];
  // Generated images, stored once the response is complete.
  const images: MediaOutput[] = [];
  const handle = (j: any) => {
    const err = embeddedError(j);
    if (err) throw err;
    if (j.promptFeedback?.blockReason) throw new ProviderError(`Blocked by Gemini: ${j.promptFeedback.blockReason}`);
    const cand = j.candidates?.[0];
    for (const part of cand?.content?.parts ?? []) {
      const inline = part.inlineData ?? part.inline_data;
      if (inline?.data) {
        // Gemini 3 image models also stream draft images while thinking; keep the final ones.
        if (!part.thought) images.push({ kind: 'image', b64: inline.data, mime: inline.mimeType ?? inline.mime_type, signature: part.thoughtSignature });
        continue;
      }
      parts.push(part);
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
    const j: any = await res.json();
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
  for (const img of images) await saveOutput(req, img);
  const mapped: Record<string, string> = { STOP: 'stop', MAX_TOKENS: 'length', FINISH_REASON_UNSPECIFIED: 'stop' };
  const toolCalls: ToolCall[] = parts
    .filter((x) => x.functionCall?.name)
    .map((x, i) => ({ id: x.functionCall.id ?? `gemini-${i}`, name: String(x.functionCall.name), args: x.functionCall.args ?? {} }));
  return {
    usage,
    finishReason: finishReason ? (mapped[finishReason] ?? finishReason.toLowerCase()) : undefined,
    ...(toolCalls.length ? { toolCalls, assistant: parts } : {}),
  };
}

export async function geminiModels(p: Provider): Promise<ModelInfo[]> {
  const res = await providerFetch(p, '/models?pageSize=1000', { method: 'GET' });
  if (!res.ok) throw await readError(res);
  const j: any = await res.json();
  return (j.models ?? [])
    // Chat models, plus Imagen (predict) and Veo (predictLongRunning).
    .filter((m: any) => !m.supportedGenerationMethods || ['generateContent', 'predict', 'predictLongRunning'].some((x) => m.supportedGenerationMethods.includes(x)))
    .map((m: any) => ({ id: String(m.name).replace(/^models\//, ''), name: m.displayName || undefined }));
}
