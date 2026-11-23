// Video generation. Every video API is a long-running job: start it, poll until it is done, then download the file.
// Each vendor has its own API; custom providers (relays) get OpenAI's /videos, then the common /video/generations.
import { ORIGIN_PATH } from '../../../shared/provider-auth';
import { checkMinimax, dashscopeTask } from './image';
import {
  closestAspect,
  closestSize,
  dataUrlToBlob,
  jsonOf,
  mediaPrompt,
  mediaVendor,
  percentOf,
  poll,
  saveOutput,
  type MediaOutput,
} from './media';
import { splitDataUrl } from '../utils';
import { JSON_HEADERS, mergeExtra, providerFetch, ProviderError, type ChatRequest, type ChatResult } from './transport';
import type { GenProgress } from '../types';

const post = (req: ChatRequest, path: string, body: unknown, headers: Record<string, string> = {}) =>
  providerFetch(req.provider, path, { method: 'POST', headers: { ...JSON_HEADERS, ...headers }, body: JSON.stringify(body), signal: req.signal }, req.fetch);
const get = (req: ChatRequest, path: string) => providerFetch(req.provider, path, { method: 'GET', signal: req.signal }, req.fetch);

const nearest = (v: number, allowed: number[]) => allowed.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
const isLandscape = (aspect?: string) => !aspect || !/^(9:16|3:4|2:3)$/.test(aspect);

function failed(message: unknown, fallback = 'Video generation failed'): never {
  const m = typeof message === 'string' ? message : (message as any)?.message ?? (message ? JSON.stringify(message) : '');
  throw new ProviderError(m || fallback);
}

/** OpenAI Sora (/videos): multipart create, poll the video, download /videos/{id}/content. */
async function openaiVideo(req: ChatRequest): Promise<ChatResult> {
  const o = req.params.media ?? {};
  const { text, images } = mediaPrompt(req);
  const form = new FormData();
  form.append('model', req.model);
  form.append('prompt', text);
  if (o.seconds) form.append('seconds', String(nearest(o.seconds, [4, 8, 12])));
  if (o.aspect || o.resolution) {
    const big = o.resolution === '1080p' && /pro/i.test(req.model);
    form.append('size', isLandscape(o.aspect) ? (big ? '1792x1024' : '1280x720') : big ? '1024x1792' : '720x1280');
  }
  if (images[0]) form.append('input_reference', dataUrlToBlob(images[0].dataUrl!), images[0].name || 'reference.png');
  for (const [k, v] of Object.entries({ ...req.provider.extraBody, ...req.params.extraBody })) {
    if (v !== null && v !== undefined) form.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  const res = await providerFetch(req.provider, '/videos', { method: 'POST', body: form, signal: req.signal }, req.fetch);
  // Relays that don't serve /videos often serve the generic task API instead.
  if ((res.status === 404 || res.status === 405) && mediaVendor(req.provider) === 'other') {
    void res.body?.cancel();
    return relayVideo(req);
  }
  const start = await jsonOf(res);
  const id = start.id ?? start.task_id;
  if (!id) failed(start.error, 'The API did not start a video job');
  const video = await poll(req, async () => {
    const j = await jsonOf(await get(req, `/videos/${encodeURIComponent(id)}`));
    const status = String(j.status ?? '').toLowerCase();
    if (status === 'completed' || status === 'succeeded') return { done: true, value: j };
    if (status === 'failed' || status === 'cancelled') failed(j.error);
    return { done: false, progress: { stage: status === 'queued' ? 'queued' : 'running', percent: percentOf(j.progress) } };
  });
  req.onDelta({ progress: { stage: 'saving' } });
  const url = video.url ?? video.video_url;
  await saveOutput(req, url ? { kind: 'video', url } : { kind: 'video', path: `/videos/${encodeURIComponent(video.id ?? id)}/content` });
  return { finishReason: 'stop' };
}

/** The task API many relays (new-api, one-api forks) use for Kling, Jimeng, Vidu and others. */
async function relayVideo(req: ChatRequest): Promise<ChatResult> {
  const o = req.params.media ?? {};
  const { text, images } = mediaPrompt(req);
  const body: Record<string, unknown> = { model: req.model, prompt: text };
  if (images[0]) body.image = images[0].dataUrl;
  if (o.seconds) body.duration = o.seconds;
  if (o.aspect) body.aspect_ratio = o.aspect;
  if (o.resolution) body.resolution = o.resolution;
  mergeExtra(body, req.provider.extraBody, req.params.extraBody);
  const start = await jsonOf(await post(req, '/video/generations', body));
  const id = start.task_id ?? start.id ?? start.data?.task_id ?? start.data?.id;
  if (!id) failed(start.error ?? start.message, 'The API did not start a video job');
  const url = await poll(req, async () => {
    const j = await jsonOf(await get(req, `/video/generations/${encodeURIComponent(id)}`));
    const d = j.data && typeof j.data === 'object' && !Array.isArray(j.data) ? { ...j, ...j.data } : j;
    const status = String(d.status ?? d.task_status ?? '').toLowerCase();
    const link = d.url ?? d.video_url ?? d.output?.url ?? d.content?.video_url ?? d.result_url ?? d.data?.[0]?.url;
    if (/succe|complet|finish|done/.test(status) || (!status && link)) {
      if (!link) failed('The job finished without a video link');
      return { done: true, value: String(link) };
    }
    if (/fail|error|cancel/.test(status)) failed(d.fail_reason ?? d.error ?? d.message);
    return { done: false, progress: { stage: /queue|pending|submit/.test(status) ? 'queued' : 'running', percent: percentOf(d.progress) } };
  });
  req.onDelta({ progress: { stage: 'saving' } });
  await saveOutput(req, { kind: 'video', url });
  return { finishReason: 'stop' };
}

/** Google Veo (Gemini API): predictLongRunning, poll the operation, download the file with the key. */
async function veo(req: ChatRequest): Promise<ChatResult> {
  const o = req.params.media ?? {};
  const { text, images } = mediaPrompt(req);
  const instance: Record<string, unknown> = { prompt: text };
  if (images[0]) {
    const { mime, data } = splitDataUrl(images[0].dataUrl!);
    instance.image = { bytesBase64Encoded: data, mimeType: mime };
  }
  const parameters: Record<string, unknown> = {};
  if (o.aspect) parameters.aspectRatio = isLandscape(o.aspect) ? '16:9' : '9:16';
  if (o.seconds) parameters.durationSeconds = /veo-?2/i.test(req.model) ? Math.max(5, Math.min(8, o.seconds)) : nearest(o.seconds, [4, 6, 8]);
  if (o.resolution && o.resolution !== '480p') parameters.resolution = o.resolution;
  if (o.negativePrompt) parameters.negativePrompt = o.negativePrompt;
  const body: Record<string, unknown> = { instances: [instance], parameters };
  mergeExtra(body, req.provider.extraBody, req.params.extraBody);
  const model = req.model.replace(/^models\//, '');
  const op = await jsonOf(await post(req, `/models/${model}:predictLongRunning`, body));
  if (!op.name) failed(op.error, 'Veo did not start a job');
  const started = Date.now();
  const result = await poll(req, async () => {
    const j = await jsonOf(await get(req, `/${String(op.name).replace(/^\/+/, '')}`));
    if (j.error) failed(j.error);
    if (j.done) return { done: true, value: j.response ?? {} };
    // Veo reports no progress; a typical job takes one to three minutes.
    return { done: false, progress: { stage: 'running', percent: Math.min(95, Math.round(((Date.now() - started) / 120_000) * 100)) } };
  });
  const gen = result.generateVideoResponse ?? result;
  const sample = (gen.generatedSamples ?? gen.generatedVideos ?? [])[0];
  const uri: string | undefined = sample?.video?.uri;
  if (!uri) {
    const why = gen.raiMediaFilteredReasons?.join('; ');
    failed(why ? `Blocked by Veo: ${why}` : 'Veo returned no video');
  }
  req.onDelta({ progress: { stage: 'saving' } });
  // The file URL is on the API host and needs the key: fetch it through the provider when it is under the base URL.
  const base = req.provider.baseUrl.replace(/\/+$/, '');
  const out: MediaOutput = uri.startsWith(`${base}/`)
    ? { kind: 'video', path: uri.slice(base.length) }
    : /^https:\/\/generativelanguage\.googleapis\.com\//.test(uri)
      ? { kind: 'video', path: `${ORIGIN_PATH}${new URL(uri).pathname}${new URL(uri).search}` }
      : { kind: 'video', url: uri };
  await saveOutput(req, out);
  return { finishReason: 'stop' };
}

/** Volcengine Ark (Doubao Seedance): /contents/generations/tasks. */
async function arkVideo(req: ChatRequest): Promise<ChatResult> {
  const o = req.params.media ?? {};
  const { text, images } = mediaPrompt(req);
  const flags: string[] = [];
  if (o.aspect) flags.push(`--ratio ${closestAspect(o.aspect, ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'])}`);
  if (o.seconds) flags.push(`--duration ${Math.max(2, Math.min(12, Math.round(o.seconds)))}`);
  if (o.resolution) flags.push(`--resolution ${o.resolution}`);
  flags.push('--watermark false');
  const content: Record<string, unknown>[] = [{ type: 'text', text: `${text} ${flags.join(' ')}` }];
  for (const [i, img] of images.slice(0, 2).entries()) {
    content.push({ type: 'image_url', image_url: { url: img.dataUrl }, ...(images.length > 1 ? { role: i ? 'last_frame' : 'first_frame' } : {}) });
  }
  const body: Record<string, unknown> = { model: req.model, content };
  mergeExtra(body, req.provider.extraBody, req.params.extraBody);
  const start = await jsonOf(await post(req, '/contents/generations/tasks', body));
  if (!start.id) failed(start.error, 'Ark did not start a task');
  const task = await poll(req, async () => {
    const j = await jsonOf(await get(req, `/contents/generations/tasks/${encodeURIComponent(start.id)}`));
    const status = String(j.status ?? '').toLowerCase();
    if (status === 'succeeded') return { done: true, value: j };
    if (status === 'failed' || status === 'cancelled' || status === 'expired') failed(j.error);
    return { done: false, progress: { stage: status === 'queued' ? 'queued' : 'running' } };
  });
  const url = task.content?.video_url;
  if (!url) failed('The task finished without a video');
  req.onDelta({ progress: { stage: 'saving' } });
  await saveOutput(req, { kind: 'video', url });
  return { finishReason: 'stop' };
}

/** Zhipu CogVideoX: /videos/generations, then /async-result/{id}. */
async function zhipuVideo(req: ChatRequest): Promise<ChatResult> {
  const o = req.params.media ?? {};
  const { text, images } = mediaPrompt(req, false);
  if (!text && !images.length) mediaPrompt(req);
  const body: Record<string, unknown> = { model: req.model };
  if (text) body.prompt = text;
  if (images[0]) body.image_url = images[0].dataUrl;
  if (o.aspect || o.resolution) {
    const tall = !isLandscape(o.aspect);
    const sizes = o.resolution === '720p' ? ['1280x720', '720x1280', '960x960'] : o.resolution === '480p' ? ['720x480', '480x720', '960x960'] : ['1920x1080', '1080x1920', '1024x1024'];
    body.size = closestSize(o.aspect ?? (tall ? '9:16' : '16:9'), sizes);
  }
  if (o.seconds) body.duration = nearest(o.seconds, [5, 10]);
  mergeExtra(body, req.provider.extraBody, req.params.extraBody);
  const start = await jsonOf(await post(req, '/videos/generations', body));
  if (!start.id) failed(start.error, 'Zhipu did not start a task');
  const result = await poll(req, async () => {
    const j = await jsonOf(await get(req, `/async-result/${encodeURIComponent(start.id)}`));
    const status = String(j.task_status ?? '').toUpperCase();
    if (status === 'SUCCESS') return { done: true, value: j };
    if (status === 'FAIL') failed(j.error ?? 'The task failed');
    return { done: false, progress: { stage: 'running' } };
  });
  const url = result.video_result?.[0]?.url;
  if (!url) failed('The task finished without a video');
  req.onDelta({ progress: { stage: 'saving' } });
  await saveOutput(req, { kind: 'video', url });
  return { finishReason: 'stop' };
}

/** SiliconFlow: /video/submit, then POST /video/status. */
async function siliconflowVideo(req: ChatRequest): Promise<ChatResult> {
  const o = req.params.media ?? {};
  const { text, images } = mediaPrompt(req);
  const body: Record<string, unknown> = { model: req.model, prompt: text, image_size: closestSize(o.aspect ?? '16:9', ['1280x720', '720x1280', '960x960']) };
  if (images[0]) body.image = images[0].dataUrl;
  if (o.negativePrompt) body.negative_prompt = o.negativePrompt;
  mergeExtra(body, req.provider.extraBody, req.params.extraBody);
  const start = await jsonOf(await post(req, '/video/submit', body));
  const id = start.requestId ?? start.request_id;
  if (!id) failed(start.message ?? start.error, 'SiliconFlow did not start a job');
  const result = await poll(req, async () => {
    const j = await jsonOf(await post(req, '/video/status', { requestId: id }));
    const status = String(j.status ?? '');
    if (status === 'Succeed') return { done: true, value: j };
    if (status === 'Failed') failed(j.reason);
    return { done: false, progress: { stage: status === 'InQueue' ? 'queued' : 'running' } };
  });
  const url = result.results?.videos?.[0]?.url;
  if (!url) failed('The job finished without a video');
  req.onDelta({ progress: { stage: 'saving' } });
  await saveOutput(req, { kind: 'video', url });
  return { finishReason: 'stop' };
}

/** MiniMax Hailuo: /video_generation, poll /query/video_generation, then look up the file's download link. */
async function minimaxVideo(req: ChatRequest): Promise<ChatResult> {
  const o = req.params.media ?? {};
  const { text, images } = mediaPrompt(req);
  const body: Record<string, unknown> = { model: req.model, prompt: text };
  if (images[0]) body.first_frame_image = images[0].dataUrl;
  if (o.seconds) body.duration = nearest(o.seconds, [6, 10]);
  if (o.resolution) body.resolution = o.resolution === '1080p' ? '1080P' : o.resolution === '480p' ? '512P' : '768P';
  mergeExtra(body, req.provider.extraBody, req.params.extraBody);
  const start = await jsonOf(await post(req, '/video_generation', body));
  checkMinimax(start);
  if (!start.task_id) failed('MiniMax did not start a task');
  const fileId = await poll(req, async () => {
    const j = await jsonOf(await get(req, `/query/video_generation?task_id=${encodeURIComponent(start.task_id)}`));
    checkMinimax(j);
    const status = String(j.status ?? '');
    if (status === 'Success') return { done: true, value: String(j.file_id) };
    if (status === 'Fail') failed('MiniMax could not generate the video');
    const progress: GenProgress = { stage: status === 'Queueing' || status === 'Preparing' ? 'queued' : 'running' };
    return { done: false, progress };
  });
  const file = await jsonOf(await get(req, `/files/retrieve?file_id=${encodeURIComponent(fileId)}`));
  checkMinimax(file);
  const url = file.file?.download_url;
  if (!url) failed('MiniMax returned no download link');
  req.onDelta({ progress: { stage: 'saving' } });
  await saveOutput(req, { kind: 'video', url });
  return { finishReason: 'stop' };
}

/**
 * Alibaba Model Studio (DashScope) Wan video: the video-synthesis task API. Wan 3.0 and later take a list of media
 * (first / last frame) with resolution and ratio; the older task-specific models (wan2.x-t2v / -i2v) take img_url and size.
 */
async function dashscopeVideo(req: ChatRequest): Promise<ChatResult> {
  const o = req.params.media ?? {};
  const { text, images } = mediaPrompt(req, false);
  if (!text && !images.length) mediaPrompt(req);
  const legacy = /^wanx|(^|\/)wan[\d.]*-?(t2v|i2v|kf2v|flf2v|s2v)/i.test(req.model);
  const input: Record<string, unknown> = {};
  if (text) input.prompt = text;
  const parameters: Record<string, unknown> = { prompt_extend: true, watermark: false };
  if (legacy) {
    if (o.negativePrompt) input.negative_prompt = o.negativePrompt;
    if (images[0]) {
      input.img_url = images[0].dataUrl;
      if (o.resolution) parameters.resolution = o.resolution.toUpperCase();
    } else if (o.aspect || o.resolution) {
      const sizes =
        o.resolution === '480p' ? ['832*480', '480*832', '624*624'] : o.resolution === '1080p' ? ['1920*1080', '1080*1920', '1440*1440'] : ['1280*720', '720*1280', '960*960'];
      parameters.size = closestSize(o.aspect ?? '16:9', sizes, '*');
    }
    if (o.seconds) parameters.duration = o.seconds;
  } else {
    if (images.length) {
      input.media = images.slice(0, 2).map((img, i) => ({ type: i ? 'last_frame' : 'first_frame', url: img.dataUrl }));
    }
    if (o.resolution) parameters.resolution = o.resolution.toUpperCase();
    if (o.aspect) parameters.ratio = closestAspect(o.aspect, ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']);
    if (o.seconds) parameters.duration = Math.max(2, Math.min(30, Math.round(o.seconds)));
  }
  const body: Record<string, unknown> = { model: req.model, input, parameters };
  mergeExtra(body, req.provider.extraBody, req.params.extraBody);
  const out = await dashscopeTask(req, `${ORIGIN_PATH}/api/v1/services/aigc/video-generation/video-synthesis`, body);
  const url = out.video_url ?? out.results?.video_url;
  if (!url) failed('The task finished without a video');
  req.onDelta({ progress: { stage: 'saving' } });
  await saveOutput(req, { kind: 'video', url });
  return { finishReason: 'stop' };
}

/** Generates a video with a video model, through the API its provider offers. */
export async function generateVideo(req: ChatRequest): Promise<ChatResult> {
  const p = req.provider;
  if (p.type === 'anthropic') throw new ProviderError('The Anthropic API cannot generate videos. Add this model under an OpenAI-compatible provider instead.');
  req.onDelta({ progress: { stage: 'queued' } });
  switch (mediaVendor(p)) {
    case 'gemini':
      return veo(req);
    case 'ark':
      return arkVideo(req);
    case 'zhipu':
      return zhipuVideo(req);
    case 'siliconflow':
      return siliconflowVideo(req);
    case 'minimax':
      return minimaxVideo(req);
    case 'dashscope':
      return dashscopeVideo(req);
    default:
      return openaiVideo(req);
  }
}
