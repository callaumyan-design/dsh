// Web search for models without a provider-native search tool: the browser runs a tool-calling loop and asks the
// server to search; the server calls the search API with the account's stored key (it never reaches the browser).

export type WebSearchKind = 'tavily' | 'brave' | 'bocha' | 'exa' | 'searxng';
export const WEB_SEARCH_KINDS: WebSearchKind[] = ['tavily', 'brave', 'bocha', 'exa', 'searxng'];

export interface WebSearchConfig {
  kind: WebSearchKind;
  apiKey?: string;
  /** SearXNG instance URL. */
  url?: string;
}

export interface WebResult {
  title: string;
  url: string;
  content: string;
}

const clip = (s: unknown, n = 1500) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

async function json(res: Response, name: string): Promise<any> {
  const text = await res.text();
  if (!res.ok) {
    let msg = text.replace(/\s+/g, ' ').slice(0, 300);
    try {
      const j = JSON.parse(text);
      msg = j.detail?.error ?? j.error?.message ?? j.error ?? j.message ?? j.msg ?? msg;
    } catch {
      /* not JSON */
    }
    throw new Error(`${name} ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  }
  return JSON.parse(text);
}

export async function webSearch(cfg: WebSearchConfig, query: string, count: number, f: typeof fetch): Promise<WebResult[]> {
  const signal = AbortSignal.timeout(25_000);
  const post = (url: string, headers: Record<string, string>, body: unknown) =>
    f(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  switch (cfg.kind) {
    case 'tavily': {
      const j = await json(
        await post('https://api.tavily.com/search', { authorization: `Bearer ${cfg.apiKey}` }, { query, max_results: count, search_depth: 'basic' }),
        'Tavily',
      );
      return (j.results ?? []).map((r: any) => ({ title: clip(r.title, 200), url: String(r.url), content: clip(r.content) }));
    }
    case 'brave': {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}&extra_snippets=true`;
      const j = await json(await f(url, { headers: { accept: 'application/json', 'x-subscription-token': cfg.apiKey ?? '' }, signal }), 'Brave');
      return (j.web?.results ?? []).map((r: any) => ({
        title: clip(r.title, 200),
        url: String(r.url),
        content: clip([r.description, ...(r.extra_snippets ?? [])].join(' ')),
      }));
    }
    case 'bocha': {
      const j = await json(
        await post('https://api.bochaai.com/v1/web-search', { authorization: `Bearer ${cfg.apiKey}` }, { query, summary: true, count }),
        'Bocha',
      );
      return (j.data?.webPages?.value ?? []).map((r: any) => ({ title: clip(r.name, 200), url: String(r.url), content: clip(r.summary || r.snippet) }));
    }
    case 'exa': {
      const j = await json(
        await post('https://api.exa.ai/search', { 'x-api-key': cfg.apiKey ?? '' }, { query, numResults: count, contents: { text: { maxCharacters: 1500 } } }),
        'Exa',
      );
      return (j.results ?? []).map((r: any) => ({ title: clip(r.title, 200), url: String(r.url), content: clip(r.text) }));
    }
    case 'searxng': {
      const base = (cfg.url ?? '').replace(/\/+$/, '');
      if (!/^https?:\/\//.test(base)) throw new Error('SearXNG URL is not set');
      const j = await json(await f(`${base}/search?q=${encodeURIComponent(query)}&format=json`, { headers: { accept: 'application/json' }, signal }), 'SearXNG');
      return (j.results ?? []).slice(0, count).map((r: any) => ({ title: clip(r.title, 200), url: String(r.url), content: clip(r.content) }));
    }
    default:
      throw new Error('Unknown search service');
  }
}
