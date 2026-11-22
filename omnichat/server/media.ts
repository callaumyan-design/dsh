// Generated images and videos: where the server keeps them, and how it fetches the files providers link to.
// The disk store lives in ./media-fs.ts (Node only); Cloudflare Workers run without one and keep media inline.

/** A stored file's id: random, plus the extension that gives its type (e.g. "3f2a….png"). */
export const MEDIA_ID_RE = /^[A-Za-z0-9-]{16,64}\.(png|jpg|webp|gif|mp4|webm|mov)$/;

export const MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

export const MEDIA_EXT: Record<string, string> = Object.fromEntries(Object.entries(MEDIA_TYPES).map(([ext, mime]) => [mime, ext]));

/** Largest file the store accepts (uploads and downloads alike). */
export const MAX_MEDIA_BYTES = 300 * 1024 * 1024;

export interface MediaBackend {
  put(userId: string, id: string, data: Uint8Array): Promise<void>;
  stat(userId: string, id: string): Promise<{ size: number } | null>;
  /** The bytes from `start` to `end` (inclusive) as a stream. */
  read(userId: string, id: string, start?: number, end?: number): ReadableStream<Uint8Array>;
  readAll(userId: string, id: string): Promise<Uint8Array | null>;
  /** Deletes files older than `olderThanMs` that no message refers to any more. Returns how many were removed. */
  sweep(isReferenced: (userId: string, url: string) => Promise<boolean>, olderThanMs: number): Promise<number>;
}

/** Reads a response body into memory, giving up past `max` bytes. */
export async function readLimited(res: Response, max = MAX_MEDIA_BYTES): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length'));
  if (declared > max) throw new Error(`File too large (${declared} bytes)`);
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      void reader.cancel();
      throw new Error('File too large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/**
 * Downloads a file a provider linked to (generated media are usually served from a CDN for a limited time).
 * Follows redirects by hand so that no hop can lead to a private address.
 */
export async function downloadPublic(
  url: string,
  o: { fetch: typeof fetch; allowPrivate: boolean; isPrivateHost(h: string): boolean; signal: AbortSignal },
): Promise<{ data: Uint8Array; mime: string }> {
  let target = new URL(url);
  for (let hop = 0; hop < 6; hop++) {
    if (target.protocol !== 'https:' && target.protocol !== 'http:') throw new Error('Unsupported protocol');
    if (!o.allowPrivate && o.isPrivateHost(target.hostname)) throw new Error('Private network addresses are not allowed');
    const res = await o.fetch(target.toString(), { redirect: 'manual', signal: AbortSignal.any([o.signal, AbortSignal.timeout(10 * 60_000)]) });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      void res.body?.cancel();
      target = new URL(res.headers.get('location')!, target);
      continue;
    }
    if (!res.ok) {
      void res.body?.cancel();
      throw new Error(`${res.status} ${res.statusText}`);
    }
    return { data: await readLimited(res), mime: res.headers.get('content-type')?.split(';')[0].trim() || 'application/octet-stream' };
  }
  throw new Error('Too many redirects');
}
