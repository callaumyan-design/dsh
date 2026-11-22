// Where the browser keeps media it generates itself (Cloudflare Workers, providers in direct mode): uploaded to the
// server's media store when it has one, else inline in the message.
import { authFetch } from '../api';
import { bytesToBase64, sniffMime } from './media';
import { setMediaStore, type MediaStore } from './transport';
import type { GeneratedMedia } from '../types';

let serverStore: boolean | null = null;

const toDataUrl = (data: Uint8Array, mime: string) => `data:${mime};base64,${bytesToBase64(data)}`;

async function blobToDataUrl(blob: Blob): Promise<string> {
  const data = new Uint8Array(await blob.arrayBuffer());
  return toDataUrl(data, sniffMime(data) ?? (blob.type || 'application/octet-stream'));
}

/** A file from this server's media store, as a Blob (the request needs the session token, so <img src> can't load it). */
export async function fetchStoredMedia(url: string, signal?: AbortSignal): Promise<Blob> {
  const res = await authFetch(url, { signal });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.blob();
}

export const browserMediaStore: MediaStore = {
  async save(data, mime, signal) {
    if (serverStore !== false) {
      try {
        const res = await authFetch('/api/media', { method: 'POST', headers: { 'content-type': mime }, body: data as BodyInit, signal });
        if (res.ok) {
          serverStore = true;
          const j = (await res.json()) as { url: string };
          return { url: j.url };
        }
        // No media store on this deployment (Workers): keep files inline from now on.
        if (res.status === 404 || res.status === 501) serverStore = false;
      } catch (err) {
        if ((err as Error).name === 'AbortError') throw err;
      }
    }
    return { dataUrl: toDataUrl(data, mime) };
  },
  async download(url, signal) {
    try {
      const res = await fetch(url, { signal });
      if (!res.ok) return null;
      const data = new Uint8Array(await res.arrayBuffer());
      return { data, mime: res.headers.get('content-type')?.split(';')[0] || 'application/octet-stream' };
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      return null; // usually CORS: the link is kept instead
    }
  },
  async load(m: GeneratedMedia, signal) {
    if (m.dataUrl) return m.dataUrl;
    if (!m.url) return null;
    try {
      const blob = m.url.startsWith('/api/media/') ? await fetchStoredMedia(m.url, signal) : await (await fetch(m.url, { signal })).blob();
      return await blobToDataUrl(blob);
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      return null;
    }
  },
};

setMediaStore(browserMediaStore);
