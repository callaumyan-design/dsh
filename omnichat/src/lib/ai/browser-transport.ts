// How the browser reaches providers: through the server proxy, or straight to the API in "direct" mode.
import { ANTHROPIC_DEFAULT_VERSION, applyAuth, joinUrl } from '../../../shared/provider-auth';
import { api, proxyFetch } from '../api';
import { flushNow, hasPending } from '../sync';
import { ProviderError, setProviderFetcher, type ProviderFetcher } from './transport';
import type { Provider } from '../types';

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

export const browserFetch: ProviderFetcher = async (p, path, init) => {
  // The server must know the latest provider config (and key) before proxying.
  if (hasPending(`provider:${p.id}`)) await flushNow();
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
};

setProviderFetcher(browserFetch);
