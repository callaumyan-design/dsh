// Image generation. Most vendors (and most relays) offer the OpenAI Images API; Gemini image models answer through
// generateContent (handled in ./gemini.ts), OpenRouter through Chat Completions (./openai.ts), and a few vendors have
// their own APIs.
import { ORIGIN_PATH } from '../../../shared/provider-auth';
import { geminiChat } from './gemini';
import {
  closestAspect,
  closestSize,
  dataUrlToBlob,
  jsonOf,
  sizeForArea,
  mediaPrompt,
  mediaVendor,
  poll,
  saveAll,
  withHistoryImages,
  type MediaOutput,
} from './media';
import { openaiChat } from './openai';
import { JSON_HEADERS, mergeExtra, providerFetch, ProviderError, type ChatRequest, type ChatResult } from './transport';
import type { Usage } from '../types';

const GPT_IMAGE_SIZES = ['1024x1024', '1536x1024', '1024x1536'];
const DALLE3_SIZES = ['1024x1024', '1792x1024', '1024x1792'];
const SEEDREAM4_SIZES = ['2048x2048', '2560x1440', '1440x2560', '2304x1728', '1728x2304', '2496x1664', '1664x2496'];
const SEEDREAM3_SIZES = ['1024x1024', '1280x720', '720x1280', '1152x864', '864x1152', '1248x832', '832x1248'];
const COGVIEW_SIZES = ['1024x1024', '1344x768', '768x1344', '1152x864', '864x1152', '1440x720', '720x1440'];
const SILICONFLOW_SIZES = ['1024x1024', '1280x720', '720x1280', '1152x864', '864x1152', '1216x832', '832x1216'];
const GENERIC_SIZES = ['1024x1024', '1280x720', '720x1280', '1152x864', '864x1152', '1216x832', '832x1216'];

function mapUsage(u: any): Usage | undefined {
  if (!u || typeof u !== 'object') return undefined;
  return { input: u.input_tokens ?? u.prompt_tokens, output: u.output_tokens ?? u.completion_tokens };
}

/** Images in an Images API style response (OpenAI, Ark, Zhipu, xAI, Together, SiliconFlow and relays). */
function imagesOf(j: any): MediaOutput[] {
  const list: any[] = j?.data ?? j?.images ?? j?.output?.results ?? [];
  const mime = typeof j?.output_format === 'string' ? `image/${j.output_format === 'jpg' ? 'jpeg' : j.output_format}` : undefined;
  return (Array.isArray(list) ? list : [])
    .map((x): MediaOutput => ({
      kind: 'image',
      b64: x?.b64_json ?? x?.b64 ?? x?.base64 ?? undefined,
      url: typeof x === 'string' ? x : (x?.url ?? x?.image_url ?? undefined),
      mime,
      revisedPrompt: x?.revised_prompt || undefined,
    }))
    .filter((x) => x.b64 || x.url);
}

/** OpenAI Images API: /images/generations, or /images/edits when the message has images attached. */
async function openaiImages(req: ChatRequest): Promise<ChatResult> {
  const p = req.provider;
  const vendor = mediaVendor(p);
  const model = req.model;
  const m = model.toLowerCase();
  const o = req.params.media ?? {};
  const { text, images } = mediaPrompt(req);
  const gptImage = /gpt-image/.test(m);
  const dalle3 = /dall-e-3/.test(m);
  const dalle2 = /dall-e-2/.test(m);
  const count = Math.max(1, Math.min(10, o.count ?? 1));

  const body: Record<string, unknown> = { model, prompt: text };
  let sizeField = 'size';
  let size: string | undefined;
  // How many images one request may return; the rest are requested in parallel.
  let perRequest = count;
  if (gptImage) {
    if (o.aspect) size = closestSize(o.aspect, GPT_IMAGE_SIZES);
    if (o.quality) body.quality = o.quality;
  } else if (dalle3) {
    if (o.aspect) size = closestSize(o.aspect, DALLE3_SIZES);
    if (o.quality) body.quality = o.quality === 'high' ? 'hd' : 'standard';
    body.response_format = 'b64_json';
    perRequest = 1;
  } else if (dalle2) {
    body.response_format = 'b64_json';
  } else if (vendor === 'ark') {
    size = closestSize(o.aspect, /seedream-[4-9]|seedream-\d{2}/.test(m) ? SEEDREAM4_SIZES : SEEDREAM3_SIZES);
    if (!o.aspect && /seedream-[4-9]/.test(m)) size = '2048x2048';
    body.response_format = 'b64_json';
    body.watermark = false;
    if (images.length) body.image = images.length === 1 ? images[0].dataUrl : images.map((a) => a.dataUrl);
    perRequest = 1;
  } else if (vendor === 'zhipu') {
    if (o.aspect) size = closestSize(o.aspect, COGVIEW_SIZES);
    perRequest = 1;
  } else if (vendor === 'siliconflow') {
    sizeField = 'image_size';
    size = closestSize(o.aspect, SILICONFLOW_SIZES);
    if (count > 1) body.batch_size = Math.min(4, count);
    perRequest = Math.min(4, count);
    if (o.negativePrompt) body.negative_prompt = o.negativePrompt;
    if (images.length) body.image = images[0].dataUrl;
  } else if (vendor === 'xai') {
    body.response_format = 'b64_json';
  } else if (vendor === 'together') {
    body.response_format = 'base64';
    if (o.aspect) {
      const [w, h] = closestSize(o.aspect, GENERIC_SIZES).split('x').map(Number);
      body.width = w;
      body.height = h;
    }
    if (o.negativePrompt) body.negative_prompt = o.negativePrompt;
  } else if (o.aspect) {
    size = closestSize(o.aspect, GENERIC_SIZES);
  }
  if (size) body[sizeField] = size;
  if (vendor !== 'siliconflow' && perRequest > 1) body.n = perRequest;
  mergeExtra(body, p.extraBody, req.params.extraBody);

  // Attached images turn the request into an edit, except where the vendor takes them in the body (above).
  const edit = images.length > 0 && !('image' in body) && !dalle3;
  const request = async (): Promise<{ outs: MediaOutput[]; usage?: Usage }> => {
    let init: RequestInit;
    if (edit) {
      const form = new FormData();
      for (const [k, v] of Object.entries(body)) {
        if (v === undefined || v === null) continue;
        form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      }
      const field = images.length > 1 ? 'image[]' : 'image';
      images.forEach((a, i) => form.append(field, dataUrlToBlob(a.dataUrl!), a.name || `image-${i + 1}.png`));
      init = { method: 'POST', body: form, signal: req.signal };
    } else {
      init = { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body), signal: req.signal };
    }
    const j = await jsonOf(await providerFetch(p, edit ? '/images/edits' : '/images/generations', init, req.fetch));
    if (j?.error && !j.data) throw new ProviderError(j.error.message ?? JSON.stringify(j.error));
    return { outs: imagesOf(j), usage: mapUsage(j.usage) };
  };

  req.onDelta({ progress: { stage: 'running' } });
  const runs = Math.ceil(count / perRequest);
  const results = await Promise.all(Array.from({ length: runs }, request));
  await saveAll(req, results.flatMap((r) => r.outs));
  const usage = results.reduce<Usage | undefined>((acc, r) => {
    if (!r.usage) return acc;
    return { input: (acc?.input ?? 0) + (r.usage.input ?? 0), output: (acc?.output ?? 0) + (r.usage.output ?? 0) };
  }, undefined);
  return { usage, finishReason: 'stop' };
}

/** Google Imagen through the Gemini API (:predict). */
async function imagen(req: ChatRequest): Promise<ChatResult> {
  const o = req.params.media ?? {};
  const { text } = mediaPrompt(req);
  const parameters: Record<string, unknown> = { sampleCount: Math.max(1, Math.min(4, o.count ?? 1)) };
  if (o.aspect) parameters.aspectRatio = closestAspect(o.aspect, ['1:1', '16:9', '9:16', '4:3', '3:4']);
  if (o.negativePrompt) parameters.negativePrompt = o.negativePrompt;
  const body: Record<string, unknown> = { instances: [{ prompt: text }], parameters };
  mergeExtra(body, req.provider.extraBody, req.params.extraBody);
  req.onDelta({ progress: { stage: 'running' } });
  const path = `/models/${req.model.replace(/^models\//, '')}:predict`;
  const j = await jsonOf(
    await providerFetch(req.provider, path, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body), signal: req.signal }, req.fetch),
  );
  const outs: MediaOutput[] = (j.predictions ?? [])
    .filter((x: any) => x?.bytesBase64Encoded)
    .map((x: any) => ({ kind: 'image', b64: x.bytesBase64Encoded, mime: x.mimeType }));
  if (!outs.length) {
    const reason = (j.predictions ?? []).map((x: any) => x?.raiFilteredReason).find(Boolean);
    throw new ProviderError(reason ? `Blocked by Imagen: ${reason}` : 'Imagen returned no images');
  }
  await saveAll(req, outs);
  return { finishReason: 'stop' };
}

const DASHSCOPE_WAN_SIZES = ['1024*1024', '1280*720', '720*1280', '1152*864', '864*1152', '1248*832', '832*1248'];

/** Older Wan image models (wanx*, wan2.x-t2i / -i2i) take a prompt string; newer ones take messages. */
export const legacyWanImage = (model: string) => /^wanx|(^|\/)wan[\d.]*-?(t2i|i2i)/i.test(model);

/** Images in a DashScope result: messages-style (`choices`) or task-style (`results`). */
function dashscopeImages(output: any): MediaOutput[] {
  const outs: MediaOutput[] = [];
  for (const c of output?.choices ?? []) {
    for (const part of c?.message?.content ?? []) if (typeof part?.image === 'string') outs.push({ kind: 'image', url: part.image });
  }
  for (const r of output?.results ?? []) if (typeof r?.url === 'string') outs.push({ kind: 'image', url: r.url });
  return outs;
}

/**
 * Alibaba Model Studio (DashScope) native image APIs. Qwen-Image and Wan 2.6+ take one user message of images and a
 * prompt (Qwen-Image synchronously, Wan as a task); older Wan models use the text2image / image2image tasks.
 */
async function dashscopeImage(req: ChatRequest): Promise<ChatResult> {
  const p = req.provider;
  const o = req.params.media ?? {};
  const m = req.model.toLowerCase();
  const { text, images } = mediaPrompt(req);
  const api = `${ORIGIN_PATH}/api/v1`;
  req.onDelta({ progress: { stage: 'running' } });

  if (legacyWanImage(m)) {
    const input: Record<string, unknown> = { prompt: text };
    if (o.negativePrompt) input.negative_prompt = o.negativePrompt;
    const parameters: Record<string, unknown> = { n: Math.max(1, Math.min(4, o.count ?? 1)) };
    let endpoint = 'text2image/image-synthesis';
    if (images.length) {
      endpoint = 'image2image/image-synthesis';
      input.images = images.map((a) => a.dataUrl);
    } else {
      parameters.size = closestSize(o.aspect, DASHSCOPE_WAN_SIZES, '*');
    }
    const body: Record<string, unknown> = { model: req.model, input, parameters };
    mergeExtra(body, p.extraBody, req.params.extraBody);
    await saveAll(req, dashscopeImages(await dashscopeTask(req, `${api}/services/aigc/${endpoint}`, body)));
    return { finishReason: 'stop' };
  }

  const wan = /(^|\/)wan/.test(m);
  const content: Record<string, unknown>[] = images.slice(0, wan ? 9 : 3).map((a) => ({ image: a.dataUrl }));
  content.push({ text });
  const parameters: Record<string, unknown> = { watermark: false };
  if (o.count && o.count > 1) parameters.n = Math.min(wan ? 4 : 6, o.count);
  if (wan) {
    // Wan 2.7: "1K" / "2K" (default) / "4K" (pro, text-to-image only), or "W*H"; edits keep the input image's shape.
    const pro = /pro/.test(m);
    if (images.length) {
      if (o.quality === 'low') parameters.size = '1K';
    } else if (o.aspect) {
      const side = o.quality === 'low' ? 1024 : o.quality === 'high' && pro ? 4096 : 2048;
      parameters.size = sizeForArea(o.aspect, side * side);
    } else if (o.quality) {
      parameters.size = o.quality === 'low' ? '1K' : o.quality === 'high' && pro ? '4K' : '2K';
    }
  } else {
    // Qwen-Image: "W*H" between 512*512 and 2048*2048 pixels; left out, the model picks.
    if (!images.length && (o.aspect || o.quality)) {
      const side = o.quality === 'low' ? 1024 : o.quality === 'high' ? 2048 : 1328;
      parameters.size = sizeForArea(o.aspect, side * side);
    }
    if (o.negativePrompt) parameters.negative_prompt = o.negativePrompt;
  }
  const body: Record<string, unknown> = { model: req.model, input: { messages: [{ role: 'user', content }] }, parameters };
  mergeExtra(body, p.extraBody, req.params.extraBody);
  let output: any;
  if (wan) {
    // Wan images take a minute or two: run them as a task rather than holding one request open.
    output = await dashscopeTask(req, `${api}/services/aigc/image-generation/generation`, body);
  } else {
    const j = await jsonOf(
      await providerFetch(p, `${api}/services/aigc/multimodal-generation/generation`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body), signal: req.signal }, req.fetch),
    );
    if (j.code && !j.output) throw new ProviderError(`${j.code} · ${j.message ?? ''}`);
    output = j.output;
  }
  await saveAll(req, dashscopeImages(output));
  return { finishReason: 'stop' };
}

/** Starts a DashScope async task and waits for its output. */
export async function dashscopeTask(req: ChatRequest, path: string, body: unknown): Promise<any> {
  const api = `${ORIGIN_PATH}/api/v1`;
  const start = await jsonOf(
    await providerFetch(
      req.provider,
      path,
      { method: 'POST', headers: { ...JSON_HEADERS, 'x-dashscope-async': 'enable' }, body: JSON.stringify(body), signal: req.signal },
      req.fetch,
    ),
  );
  const id = start.output?.task_id;
  if (!id) throw new ProviderError(start.message ? `${start.code ?? ''} · ${start.message}` : 'DashScope did not start a task');
  return poll(req, async () => {
    const j = await jsonOf(await providerFetch(req.provider, `${api}/tasks/${encodeURIComponent(id)}`, { method: 'GET', signal: req.signal }, req.fetch));
    const out = j.output ?? {};
    const status = String(out.task_status ?? '').toUpperCase();
    if (status === 'SUCCEEDED') return { done: true, value: out };
    if (status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN') {
      throw new ProviderError(`${out.code ?? status} · ${out.message ?? 'The task failed'}`);
    }
    return { done: false, progress: { stage: status === 'PENDING' ? 'queued' : 'running' } };
  });
}

/** MiniMax image-01. */
async function minimaxImage(req: ChatRequest): Promise<ChatResult> {
  const o = req.params.media ?? {};
  const { text, images } = mediaPrompt(req);
  const body: Record<string, unknown> = {
    model: req.model,
    prompt: text,
    response_format: 'base64',
    n: Math.max(1, Math.min(9, o.count ?? 1)),
  };
  if (o.aspect) body.aspect_ratio = closestAspect(o.aspect, ['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', '21:9']);
  if (images.length) body.subject_reference = [{ type: 'character', image_file: images[0].dataUrl }];
  mergeExtra(body, req.provider.extraBody, req.params.extraBody);
  req.onDelta({ progress: { stage: 'running' } });
  const j = await jsonOf(
    await providerFetch(req.provider, '/image_generation', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body), signal: req.signal }, req.fetch),
  );
  checkMinimax(j);
  const b64: string[] = j.data?.image_base64 ?? [];
  const urls: string[] = j.data?.image_urls ?? [];
  await saveAll(req, [...b64.map((b): MediaOutput => ({ kind: 'image', b64: b })), ...urls.map((u): MediaOutput => ({ kind: 'image', url: u }))]);
  return { finishReason: 'stop' };
}

/** MiniMax reports errors in base_resp with HTTP 200. */
export function checkMinimax(j: any) {
  const code = j?.base_resp?.status_code;
  if (code !== undefined && code !== 0) throw new ProviderError(`${code} · ${j.base_resp.status_msg ?? 'MiniMax error'}`);
}

/** Generates images with an image model, through the API its provider offers. */
export async function generateImage(req: ChatRequest): Promise<ChatResult> {
  const p = req.provider;
  if (p.type === 'anthropic') {
    throw new ProviderError('The Anthropic API cannot generate images. Add this model under an OpenAI-compatible provider instead.');
  }
  if (p.type === 'gemini') {
    if (/imagen/i.test(req.model)) return imagen(req);
    // Gemini image models are chat models that answer with images, and can edit what they made earlier.
    req.onDelta({ progress: { stage: 'running' } });
    return geminiChat({ ...req, messages: await withHistoryImages(req), tools: undefined, toolRounds: undefined });
  }
  switch (mediaVendor(p)) {
    case 'openrouter':
      req.onDelta({ progress: { stage: 'running' } });
      return openaiChat({ ...req, tools: undefined, toolRounds: undefined });
    case 'dashscope':
      return dashscopeImage(req);
    case 'minimax':
      return minimaxImage(req);
    default:
      // Relays usually serve Gemini image models through Chat Completions, answering with inline images.
      if (/gemini|nano-banana|gpt-4o-image/i.test(req.model) && !/imagen/i.test(req.model)) {
        req.onDelta({ progress: { stage: 'running' } });
        return openaiChat({ ...req, tools: undefined, toolRounds: undefined });
      }
      return openaiImages(req);
  }
}
