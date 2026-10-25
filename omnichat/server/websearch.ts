// Web search for models without a provider-native search tool: the browser runs a tool-calling loop and asks the
// server to search; the server calls the search API with the account's stored key (it never reaches the browser).

export type WebSearchKind = 'exa-free' | 'deepseek' | 'tavily' | 'brave' | 'bocha' | 'exa' | 'searxng';
export const WEB_SEARCH_KINDS: WebSearchKind[] = ['exa-free', 'deepseek', 'tavily', 'brave', 'bocha', 'exa', 'searxng'];
/** Services that work without an API key. */
export const KEYLESS_KINDS: WebSearchKind[] = ['exa-free', 'searxng'];
/** Used until the account picks a service, so search works out of the box. */
export const DEFAULT_WEB_SEARCH: WebSearchConfig = { kind: 'exa-free' };

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

/** Exa's MCP tool answers with one text block: results separated by `---`, each with Title/URL/... header lines. */
function parseExaText(text: string): WebResult[] {
  return text
    .split(/\n\s*-{3,}\s*\n/)
    .map((block) => {
      const field = (name: string) => block.match(new RegExp(`^${name}:[ \\t]*(.*)$`, 'm'))?.[1]?.trim() ?? '';
      const body = block.match(/^(?:Highlights|Text|Summary|Content):[ \t]*([\s\S]*)$/m)?.[1];
      return { title: clip(field('Title'), 200), url: field('URL'), content: clip(body) };
    })
    .filter((r) => /^https?:\/\//.test(r.url));
}

export async function webSearch(cfg: WebSearchConfig, query: string, count: number, f: typeof fetch): Promise<WebResult[]> {
  const signal = AbortSignal.timeout(25_000);
  const post = (url: string, headers: Record<string, string>, body: unknown) =>
    f(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  switch (cfg.kind) {
    case 'exa-free': {
      // Exa's hosted MCP server, the one OpenCode's websearch tool uses: no key, but rate-limited.
      const res = await post(
        'https://mcp.exa.ai/mcp',
        { accept: 'application/json, text/event-stream' },
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'web_search_exa', arguments: { query, numResults: count, type: 'auto', livecrawl: 'fallback', contextMaxCharacters: 1500 * count } },
        },
      );
      const text = await res.text();
      if (!res.ok) throw new Error(`Exa ${res.status}: ${text.replace(/\s+/g, ' ').slice(0, 300)}`);
      // Streamable HTTP: either a JSON body or an event stream whose data line holds the JSON-RPC response.
      const raw = (res.headers.get('content-type') ?? '').includes('json')
        ? text
        : (text
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .pop()
            ?.slice(5) ?? '');
      let j: any;
      try {
        j = JSON.parse(raw);
      } catch {
        throw new Error(`Exa: unexpected response ${text.replace(/\s+/g, ' ').slice(0, 200)}`);
      }
      if (j.error) throw new Error(`Exa: ${j.error.message ?? JSON.stringify(j.error)}`);
      const out = (j.result?.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
      if (j.result?.isError) throw new Error(`Exa: ${clip(out, 300)}`);
      return parseExaText(out).slice(0, count);
    }
    case 'deepseek': {
      // https://api-docs.deepseek.com/zh-cn/guides/search — billed per successful search; query is capped at 128 characters.
      const j = await json(
        await post('https://api.deepseek.com/v1/tools/search', { authorization: `Bearer ${cfg.apiKey}` }, { query: [...query].slice(0, 128).join(''), count }),
        'DeepSeek',
      );
      return (j.results ?? []).map((r: any) => ({ title: clip(r.title, 200), url: String(r.url), content: clip(r.summary || r.snippet) }));
    }
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
