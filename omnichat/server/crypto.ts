// WebCrypto helpers that run unchanged on Node and Cloudflare Workers.

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const toBase64Url = (bytes: Uint8Array) =>
  toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function randomToken(bytes = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function randomId(): string {
  return crypto.randomUUID();
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(input)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/** Format: pbkdf2$<iterations>$<salt b64>$<hash b64> */
export async function hashPassword(password: string, iterations: number): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, iterations);
  return `pbkdf2$${iterations}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split('$');
  if (scheme !== 'pbkdf2' || !iter || !salt || !hash) return false;
  const actual = await pbkdf2(password, fromBase64(salt), Number(iter));
  return timingSafeEqual(actual, fromBase64(hash));
}

const keyCache = new Map<string, Promise<CryptoKey>>();

/**
 * Key derivation for stored API keys. Without a salt the key is SHA-256(secret), the original format; with
 * APP_KDF_SALT it is domain-separated as SHA-256("omnichat/api-key/v1\0" + salt + "\0" + secret).
 */
function aesKey(secret: string, kdfSalt?: string): Promise<CryptoKey> {
  const material = kdfSalt === undefined ? secret : `omnichat/api-key/v1\0${kdfSalt}\0${secret}`;
  let k = keyCache.get(material);
  if (!k) {
    k = crypto.subtle
      .digest('SHA-256', enc.encode(material))
      .then((raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']));
    keyCache.set(material, k);
  }
  return k;
}

/** Encrypts API keys at rest with AES-GCM. Format: v1:<iv b64>:<ciphertext b64> */
export async function encryptSecret(plain: string, secret: string, kdfSalt?: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(secret, kdfSalt), enc.encode(plain));
  return `v1:${toBase64(iv)}:${toBase64(new Uint8Array(ct))}`;
}

export async function decryptSecret(stored: string, secret: string, kdfSalt?: string): Promise<string> {
  if (!stored.startsWith('v1:')) return stored;
  const [, iv, ct] = stored.split(':');
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(iv) as BufferSource },
    await aesKey(secret, kdfSalt),
    fromBase64(ct) as BufferSource,
  );
  return dec.decode(pt);
}

/**
 * Decrypts with the current derivation, falling back to the others a deployment may have written before
 * (unsalted, and salted with an empty salt). `stale` tells the caller to re-encrypt with the current one.
 * Returns null when no derivation fits, i.e. the server secret changed.
 */
export async function decryptSecretAny(
  stored: string,
  secret: string,
  kdfSalt?: string,
): Promise<{ plain: string; stale: boolean } | null> {
  const candidates = [kdfSalt, undefined, ''].filter((s, i, all) => all.indexOf(s) === i);
  for (const salt of candidates) {
    try {
      return { plain: await decryptSecret(stored, secret, salt), stale: salt !== kdfSalt };
    } catch {
      /* try the next derivation */
    }
  }
  return null;
}

export function maskKey(key: string): string {
  const k = key.trim();
  if (k.length <= 8) return '•'.repeat(k.length);
  return `${k.slice(0, 3)}…${k.slice(-4)}`;
}
