import { ANTHROPIC_DEFAULT_VERSION, applyAuth, joinUrl } from '../../../shared/provider-auth';
import { api, proxyFetch } from '../api';
import { flushNow, hasPending } from '../sync';
import type { Attachment, ChatParams, Provider, Source, Usage } from '../types';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  attachments?: Attachment[];
}

export interface Delta {
  content?: string;
  reasoning?: string;
  /** Pages cited by provider-native web search. */
  sources?: Source[];
  /** A web search the model is running. */
  searching?: string;
}

export interface ChatRequest {
  provider: Provider;
  model: string;
  system?: string;
  messages: ChatTurn[];
  params: ChatParams;
  signal: AbortSignal;
  onDelta(d: Delta): void;
  /** Stable per-conversation id, for gateways that route and cache by session (OpenCode Go). */
  sessionId?: string;
  /** Functions the model may call (see ./tools.ts). */
  tools?: ToolDef[];
  /** 'none' keeps the tools declared (earlier rounds used them) but asks for a final answer. */
  toolChoice?: 'auto' | 'none';
  /** Earlier rounds of this reply's tool loop, replayed after the last user turn. */
  toolRounds?: ToolRound[];
}

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema of the arguments object. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolRound {
  /** The assistant turn that made the calls, in the adapter's own wire format (thinking signatures included). */
  assistant: unknown;
  calls: ToolCall[];
  results: { id: string; name: string; content: string }[];
}

/** A provider as one request sees it: adapters for multi-protocol gateways add a path prefix and per-request headers. */
export type WireProvider = Provider & { pathPrefix?: string; requestHeaders?: Record<string, string> };

export interface ChatResult {
  usage?: Usage;
  finishReason?: string;
  /** Set when the model stopped to call tools; `assistant` is that turn in wire format, for the next round. */
  toolCalls?: ToolCall[];
  assistant?: unknown;
}

/** Parses streamed tool arguments; models occasionally emit an empty string for "no arguments". */
export function parseArgs(s: string | undefined): Record<string, unknown> {
  if (!s?.trim()) return {};
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

export class ProviderError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

const keyCache = new Map<string, string>();

export function forgetProviderKey(providerId?: string) {
  if (providerId) keyCache.delete(providerId);
  else keyCache.clear();
}

async function getKey(p: Provider): Promise<string> {
  if (!p.hasKey) return '';
  const cached = keyCache.get(p.id);
  if (cached !== undefined) return cached;
  const r = await api<{ apiKey: string }>(`/api/providers/${encodeURIComponent(p.id)}/key`);
  keyCache.set(p.id, r.apiKey);
  return r.apiKey;
}

/** Sends a request to a provider, either through the server proxy or straight from the browser. */
export async function providerFetch(p: WireProvider, path: string, init: RequestInit): Promise<Response> {
  // The server must know the latest provider config (and key) before proxying.
  if (hasPending(`provider:${p.id}`)) await flushNow();
  if (p.pathPrefix) path = p.pathPrefix + (path.startsWith('/') ? path : `/${path}`);
  if (p.requestHeaders) {
    const h = new Headers(init.headers);
    for (const [k, v] of Object.entries(p.requestHeaders)) h.set(k, v);
    init = { ...init, headers: h };
  }
  if (p.mode === 'direct') {
    if (!p.baseUrl) throw new ProviderError('Base URL is empty');
    const headers = new Headers(init.headers);
    for (const [k, v] of Object.entries(p.headers ?? {})) if (k) headers.set(k, v);
    if (p.type === 'anthropic') {
      if (!headers.has('anthropic-version')) headers.set('anthropic-version', ANTHROPIC_DEFAULT_VERSION);
      headers.set('anthropic-dangerous-direct-browser-access', 'true');
    }
    applyAuth(headers, p, await getKey(p));
    try {
      return await fetch(joinUrl(p.baseUrl, path), { ...init, headers });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      throw new ProviderError(
        `Cannot reach ${p.baseUrl} from the browser. Check the address, CORS settings (e.g. OLLAMA_ORIGINS=*), or switch to server proxy mode.`,
      );
    }
  }
  return proxyFetch(p.id, path, init);
}

function pickMessage(j: unknown): string | undefined {
  if (!j || typeof j !== 'object') return undefined;
  const o = (Array.isArray(j) ? j[0] : j) as Record<string, unknown>;
  const e = o.error;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') {
    const eo = e as Record<string, unknown>;
    const m = eo.message ?? eo.msg ?? eo.code;
    if (m) return String(m);
  }
  for (const k of ['message', 'msg', 'detail', 'error_msg']) {
    const v = o[k];
    if (typeof v === 'string' && v) return v;
  }
  return undefined;
}

export async function readError(res: Response): Promise<ProviderError> {
  const text = await res.text().catch(() => '');
  let msg: string | undefined;
  try {
    msg = pickMessage(JSON.parse(text));
  } catch {
    /* not JSON */
  }
  if (!msg) msg = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400) || res.statusText;
  return new ProviderError(`${res.status} · ${msg}`, res.status);
}

/** Error objects embedded in a stream or JSON body. */
export function embeddedError(j: unknown): ProviderError | null {
  if (!j || typeof j !== 'object') return null;
  const o = j as Record<string, unknown>;
  if (o.error || o.type === 'error') return new ProviderError(pickMessage(j) ?? JSON.stringify(o.error ?? o));
  return null;
}

export function attachmentsAsText(atts: Attachment[] | undefined): string {
  return (atts ?? [])
    .filter((a) => a.kind === 'text' && a.text != null)
    .map((a) => `<file name="${a.name.replace(/"/g, "'")}">\n${a.text}\n</file>`)
    .join('\n\n');
}

export function userText(turn: ChatTurn): string {
  const files = attachmentsAsText(turn.attachments);
  return files ? `${files}\n\n${turn.content}` : turn.content;
}

export const JSON_HEADERS = { 'content-type': 'application/json' };

/** Shallow-merges extra body JSON; a null value removes the key (e.g. {"stream_options": null}). */
export function mergeExtra(body: Record<string, unknown>, ...extras: (Record<string, unknown> | undefined)[]) {
  for (const extra of extras) {
    if (!extra || typeof extra !== 'object') continue;
    for (const [k, v] of Object.entries(extra)) {
      if (v === null) delete body[k];
      else body[k] = v;
    }
  }
}
