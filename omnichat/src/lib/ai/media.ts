// Image and video generation: which models generate media, and the plumbing shared by their adapters (./image.ts,
// ./video.ts): the prompt, size mapping, polling long-running jobs, and storing what comes back. Runs in the browser and,
// for background generation, on the server.
import { mediaStoreOf, providerFetch, ProviderError, readError, userText, type ChatRequest, type ChatTurn } from './transport';
import { uid } from '../utils';
import type { Attachment, GeneratedMedia, GenProgress, MediaParams, ModelOutput, Provider } from '../types';

// Video first: several video ids also match the image patterns (wanx2.1-t2v, jimeng-video, grok-imagine-video).
const VIDEO_RE =
  /sora|(^|\/)veo-?\d|kling|seedance|hailuo|video|(^|[/-])[ist]2v(-|$)|cogvideo|vidu|pika|runway|(^|\/)ray-?\d|luma|wan[\d.]*-?(t2v|i2v|s2v|kf2v|flf2v)|mochi|ltx|pixverse/i;
const IMAGE_RE =
  /gpt-image|dall-e|imagen|(^|\/)image-0\d|flux|stable-diffusion|sdxl|sd3|(^|\/)sd-|seedream|seededit|cogview|wanx|wan[\d.]*-?(t2i|i2i)|qwen-image|kolors|hunyuan-?image|hidream|ideogram|recraft|midjourney|jimeng|playground-v|grok-2-image|grok-imagine|nano-banana|gemini[\w.-]*image|step-1x|janus-pro|z-image|gpt-4o-image|(^|[/-])image(-preview|-generation|-edit)?$|-image-/i;

/** What a model produces, guessed from its id. */
export function guessOutput(model: string): ModelOutput {
  if (VIDEO_RE.test(model)) return 'video';
  if (IMAGE_RE.test(model)) return 'image';
  return 'text';
}

/** What a model produces: as set in the provider's model list, else guessed from the id. */
export function modelOutput(p: Pick<Provider, 'models'> | undefined, model: string): ModelOutput {
  return p?.models?.find((m) => m.id === model)?.output ?? guessOutput(model);
}

export const isMediaModel = (p: Pick<Provider, 'models'> | undefined, model: string) => modelOutput(p, model) !== 'text';

/** The host of a provider's base URL ('' when it isn't a URL). */
export function hostOf(p: Pick<Provider, 'baseUrl'>): string {
  try {
    return new URL(p.baseUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Which vendor's media API a provider speaks: by preset, then by the host of its base URL. */
export type MediaVendor = 'openai' | 'gemini' | 'openrouter' | 'ark' | 'zhipu' | 'siliconflow' | 'minimax' | 'dashscope' | 'xai' | 'together' | 'other';

export function mediaVendor(p: Provider): MediaVendor {
  if (p.type === 'gemini') return 'gemini';
  const host = hostOf(p);
  const byHost: [RegExp, MediaVendor][] = [
    [/(^|\.)openrouter\.ai$/, 'openrouter'],
    [/volces\.com$|bytepluses\.com$|volcengine/, 'ark'],
    [/bigmodel\.cn$|(^|\.)z\.ai$/, 'zhipu'],
    [/siliconflow\.(cn|com)$/, 'siliconflow'],
    [/minimaxi?\.(com|io|chat)$/, 'minimax'],
    [/dashscope(-intl)?\.aliyuncs\.com$/, 'dashscope'],
    [/(^|\.)x\.ai$/, 'xai'],
    [/together\.(xyz|ai)$/, 'together'],
    [/(^|\.)openai\.com$|openai\.azure\.com$/, 'openai'],
  ];
  for (const [re, v] of byHost) if (re.test(host)) return v;
  switch (p.presetId) {
    case 'openrouter':
      return 'openrouter';
    case 'doubao':
      return 'ark';
    case 'zhipu':
      return 'zhipu';
    case 'siliconflow':
      return 'siliconflow';
    case 'minimax':
      return 'minimax';
    case 'qwen':
      return 'dashscope';
    case 'xai':
      return 'xai';
    case 'together':
      return 'together';
    case 'openai':
    case 'azure':
      return 'openai';
    default:
      return 'other';
  }
}

// ---------- Prompt ----------

export interface MediaPrompt {
  /** The latest user message (with any text files), trimmed. */
  text: string;
  /** Images attached to it: references for editing, or the first frame of a video. */
  images: Attachment[];
}

/** What to generate: media models work from the latest user message only. */
export function mediaPrompt(req: ChatRequest, needText = true): MediaPrompt {
  let turn: ChatTurn | undefined;
  for (let i = req.messages.length - 1; i >= 0; i--) {
    if (req.messages[i].role === 'user') {
      turn = req.messages[i];
      break;
    }
  }
  const text = turn ? userText(turn).trim() : '';
  const images = (turn?.attachments ?? []).filter((a) => a.kind === 'image' && a.dataUrl);
  if (needText && !text) throw new ProviderError('Describe what to generate: this model needs a text prompt.');
  return { text, images };
}

// ---------- Sizes ----------

/** Width / height of an aspect ratio such as '16:9' (1 when unset or malformed). */
export function aspectValue(aspect: string | undefined): number {
  const m = /^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/.exec(aspect ?? '');
  return m && Number(m[2]) ? Number(m[1]) / Number(m[2]) : 1;
}

/** The size from `sizes` whose shape is closest to the requested aspect ratio. */
export function closestSize(aspect: string | undefined, sizes: string[], sep = 'x'): string {
  const want = Math.log(aspectValue(aspect));
  let best = sizes[0];
  let bestDiff = Infinity;
  for (const s of sizes) {
    const [w, h] = s.split(sep).map(Number);
    const diff = Math.abs(Math.log(w / h) - want);
    if (diff < bestDiff - 1e-9) {
      best = s;
      bestDiff = diff;
    }
  }
  return best;
}

/** Common aspect ratios a picker offers. */
export const ASPECTS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'];

/** Nearest ratio from a fixed list (for APIs that take a ratio rather than a size). */
export function closestAspect(aspect: string | undefined, allowed: string[]): string {
  return closestSize(aspect, allowed.map((a) => a.replace(':', 'x'))).replace('x', ':');
}

// ---------- Bytes ----------

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

/** Recognizes common image and video formats from their first bytes. */
export function sniffMime(b: Uint8Array): string | undefined {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  if (at(4, 0x66, 0x74, 0x79, 0x70)) return at(8, 0x71, 0x74) ? 'video/quicktime' : 'video/mp4';
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return 'video/webm';
  return undefined;
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) return new Blob([]);
  const bytes = m[2] ? base64ToBytes(m[3]) : new TextEncoder().encode(decodeURIComponent(m[3]));
  return new Blob([bytes as BlobPart], { type: m[1] || 'application/octet-stream' });
}

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};
export const extOf = (mime: string) => EXT[mime] ?? mime.split('/')[1]?.replace(/[^a-z0-9]/g, '') ?? 'bin';

// ---------- Storing results ----------

/** One generated file as an API returns it. */
export interface MediaOutput {
  kind: 'image' | 'video';
  /** Base64 (or a data: URL). */
  b64?: string;
  bytes?: Uint8Array;
  /** A link to the file (often temporary). */
  url?: string;
  /** Path under the provider's base URL that returns the file; the request carries the API key. */
  path?: string;
  mime?: string;
  revisedPrompt?: string;
  signature?: string;
}

/** Stores one generated file and adds it to the reply. */
export async function saveOutput(req: ChatRequest, out: MediaOutput): Promise<GeneratedMedia> {
  const store = mediaStoreOf(req);
  let data: Uint8Array | undefined = out.bytes;
  let mime = out.mime;
  if (!data && out.b64) {
    if (out.b64.startsWith('data:')) {
      const m = /^data:([^;,]+)?;base64,(.*)$/s.exec(out.b64);
      if (m) {
        mime ??= m[1];
        data = base64ToBytes(m[2]);
      }
    } else {
      data = base64ToBytes(out.b64);
    }
  }
  if (!data && out.path) {
    const res = await providerFetch(req.provider, out.path, { method: 'GET', signal: req.signal }, req.fetch);
    if (!res.ok) throw await readError(res);
    data = new Uint8Array(await res.arrayBuffer());
    mime ??= res.headers.get('content-type')?.split(';')[0] || undefined;
  }
  if (!data && out.url) {
    if (out.url.startsWith('data:')) return saveOutput(req, { ...out, url: undefined, b64: out.url });
    const got = await store.download(out.url, req.signal);
    if (!got) {
      // Unreachable from here (e.g. the browser is blocked by CORS): keep the provider's link.
      const media: GeneratedMedia = { id: uid(), kind: out.kind, mime: mime ?? (out.kind === 'video' ? 'video/mp4' : 'image/png'), url: out.url };
      if (out.revisedPrompt) media.revisedPrompt = out.revisedPrompt;
      req.onDelta({ media: [media] });
      return media;
    }
    data = got.data;
    mime ??= got.mime;
  }
  if (!data?.length) throw new ProviderError('The API returned no file');
  const sniffed = sniffMime(data);
  if (sniffed) mime = sniffed;
  else if (!mime || mime === 'application/octet-stream' || mime.startsWith('application/') || mime.startsWith('text/')) {
    mime = out.kind === 'video' ? 'video/mp4' : 'image/png';
  }
  const kind = mime.startsWith('video/') ? 'video' : mime.startsWith('image/') ? 'image' : out.kind;
  const loc = await store.save(data, mime, req.signal);
  const media: GeneratedMedia = { id: uid(), kind, mime, size: data.length, ...loc };
  if (out.revisedPrompt) media.revisedPrompt = out.revisedPrompt;
  if (out.signature) media.signature = out.signature;
  req.onDelta({ media: [media] });
  return media;
}

export async function saveAll(req: ChatRequest, outs: MediaOutput[]): Promise<GeneratedMedia[]> {
  if (!outs.length) throw new ProviderError('The API returned no images');
  const saved: GeneratedMedia[] = [];
  for (const o of outs) saved.push(await saveOutput(req, o));
  return saved;
}

/** Copies of the turns with the images of the latest assistant replies loaded inline (models that edit what they made). */
export async function withHistoryImages(req: ChatRequest, max = 3): Promise<ChatTurn[]> {
  const store = mediaStoreOf(req);
  const turns = req.messages.map((m) => ({ ...m }));
  let left = max;
  for (let i = turns.length - 1; i >= 0 && left > 0; i--) {
    const media = turns[i].media;
    if (turns[i].role !== 'assistant' || !media?.length) continue;
    const loaded: GeneratedMedia[] = [];
    for (const m of media) {
      if (m.kind !== 'image' || left <= 0) continue;
      const dataUrl = m.dataUrl ?? (await store.load(m, req.signal).catch(() => null));
      if (dataUrl) {
        loaded.push({ ...m, dataUrl });
        left--;
      }
    }
    turns[i].media = loaded;
  }
  // Older replies keep their placeholder text only.
  for (const t of turns) if (t.media?.some((m) => !m.dataUrl)) t.media = t.media.filter((m) => m.dataUrl);
  return turns;
}

// ---------- Long-running jobs ----------

function abortError(): Error {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export interface PollState<T> {
  done: boolean;
  value?: T;
  progress?: GenProgress;
}

/** Polls a job until it is done. Network blips and 5xx answers are retried a few times; other errors end it. */
export async function poll<T>(req: ChatRequest, check: () => Promise<PollState<T>>, timeoutMs = 45 * 60_000): Promise<T> {
  const started = Date.now();
  let delay = 2500;
  let failures = 0;
  for (;;) {
    if (req.signal.aborted) throw abortError();
    let state: PollState<T>;
    try {
      state = await check();
      failures = 0;
    } catch (err) {
      const status = (err as ProviderError).status;
      const transient = (err as Error).name !== 'AbortError' && (status === undefined || status === 429 || status >= 500);
      if (!transient || ++failures > 5) throw err;
      state = { done: false };
    }
    if (state.done) return state.value as T;
    if (state.progress) req.onDelta({ progress: state.progress });
    if (Date.now() - started > timeoutMs) throw new ProviderError('Timed out waiting for the result');
    await sleep(delay, req.signal);
    delay = Math.min(Math.round(delay * 1.25), 10_000);
  }
}

/** Reads a JSON response, turning HTTP errors into ProviderErrors. */
export async function jsonOf(res: Response): Promise<any> {
  if (!res.ok) throw await readError(res);
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new ProviderError(`Unexpected response: ${text.slice(0, 200)}`);
  }
}

/** A 0-100 progress value from whatever a job API reports (0.42, 42, "42%"). */
export function percentOf(v: unknown): number | undefined {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n) || n < 0) return undefined;
  const p = n <= 1 && !(typeof v === 'string' && v.includes('%')) && n !== 1 ? n * 100 : n;
  return Math.max(0, Math.min(100, Math.round(p)));
}

export type { MediaParams };
