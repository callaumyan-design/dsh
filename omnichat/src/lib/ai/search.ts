// Provider-native web search: how each provider turns it on, and how cited sources come back.
import type { Provider, Source } from '../types';

export type SearchMode =
  | 'anthropic' // server tool web_search
  | 'gemini' // google_search grounding tool
  | 'openai-search-model' // *-search-preview models: web_search_options
  | 'openai-responses' // Responses API web_search tool
  | 'qwen' // enable_search
  | 'zhipu' // tools: [{type: 'web_search'}]
  | 'openrouter' // plugins: [{id: 'web'}]
  | 'baidu' // web_search: {enable}
  | 'hunyuan' // enable_enhancement
  | 'builtin'; // the model always searches (Perplexity); no toggle needed

export function searchMode(p: Provider, model: string): SearchMode | null {
  if (p.type === 'anthropic') return p.presetId === 'anthropic' ? 'anthropic' : null;
  if (p.type === 'gemini') return 'gemini';
  if (p.useResponsesApi) return 'openai-responses';
  switch (p.presetId) {
    case 'openai':
    case 'azure':
      return /search/i.test(model) ? 'openai-search-model' : null;
    case 'qwen':
      return 'qwen';
    case 'zhipu':
      return 'zhipu';
    case 'openrouter':
      return 'openrouter';
    case 'baidu':
      return 'baidu';
    case 'hunyuan':
      return 'hunyuan';
    case 'perplexity':
      return 'builtin';
    default:
      return null;
  }
}

/** Adds the search switch to an OpenAI-compatible chat request body. */
export function applyOpenAISearch(body: Record<string, unknown>, mode: SearchMode) {
  switch (mode) {
    case 'openai-search-model':
      body.web_search_options = {};
      break;
    case 'qwen':
      body.enable_search = true;
      body.search_options = { enable_source: true };
      break;
    case 'zhipu':
      body.tools = [...((body.tools as unknown[]) ?? []), { type: 'web_search', web_search: { enable: true, search_result: true } }];
      break;
    case 'openrouter':
      body.plugins = [...((body.plugins as unknown[]) ?? []), { id: 'web' }];
      break;
    case 'baidu':
      body.web_search = { enable: true, enable_citation: true };
      break;
    case 'hunyuan':
      body.enable_enhancement = true;
      body.citation = true;
      break;
    default:
      break;
  }
}

function add(out: Source[], url: unknown, title?: unknown) {
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return;
  if (out.some((s) => s.url === url)) return;
  out.push({ url, title: typeof title === 'string' && title.trim() ? title.trim() : undefined });
}

/** Collects cited sources from the many shapes OpenAI-compatible providers use. */
export function openAISources(chunk: Record<string, any>): Source[] {
  const out: Source[] = [];
  const choice = chunk.choices?.[0];
  const annotations = choice?.delta?.annotations ?? choice?.message?.annotations;
  if (Array.isArray(annotations)) {
    for (const a of annotations) if (a?.type === 'url_citation') add(out, a.url_citation?.url ?? a.url, a.url_citation?.title ?? a.title);
  }
  if (Array.isArray(chunk.search_results)) for (const r of chunk.search_results) add(out, r?.url, r?.title);
  if (Array.isArray(chunk.citations)) for (const c of chunk.citations) add(out, typeof c === 'string' ? c : c?.url, c?.title);
  if (Array.isArray(chunk.web_search)) for (const r of chunk.web_search) add(out, r?.link ?? r?.url, r?.title);
  if (Array.isArray(chunk.search_info?.search_results)) for (const r of chunk.search_info.search_results) add(out, r?.url, r?.title);
  if (Array.isArray(chunk.search_info)) for (const r of chunk.search_info) add(out, r?.url, r?.title);
  return out;
}

export function mergeSources(into: Source[], more: Source[] | undefined) {
  for (const s of more ?? []) if (!into.some((x) => x.url === s.url)) into.push(s);
  return into;
}
