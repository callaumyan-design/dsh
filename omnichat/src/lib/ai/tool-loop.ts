// The web search tool loop, shared by the browser and the server: runs the model, executes the searches it asks for,
// and feeds the results back until it answers. Where searches run is passed in.
import { streamChat } from './core';
import { ProviderError, type ChatRequest, type ChatResult, type ToolCall, type ToolDef, type ToolRound } from './transport';
import type { Source, Usage } from '../types';

export interface WebResult {
  title: string;
  url: string;
  content: string;
}

/** Runs one search for the model; throws on failure (the error text is handed to the model). */
export type SearchFn = (query: string, signal: AbortSignal) => Promise<WebResult[]>;

const WEB_SEARCH: ToolDef = {
  name: 'web_search',
  description:
    'Search the web. Use it for recent events, facts you are unsure about, prices, documentation, or anything after your ' +
    'training cutoff. Search in the language most likely to find good sources; call it again with a refined query if the ' +
    'results are not enough. Cite the sources you use as markdown links.',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string', description: 'The search query' } },
    required: ['query'],
  },
};

async function runWebSearch(call: ToolCall, req: ChatRequest, search: SearchFn): Promise<string> {
  const query = String(call.args.query ?? '').trim();
  if (!query) return 'Error: the query is empty.';
  req.onDelta({ searching: query });
  try {
    const results = await search(query, req.signal);
    if (!results.length) return `No results for "${query}".`;
    req.onDelta({ sources: results.map((r): Source => ({ url: r.url, title: r.title || undefined })) });
    const today = new Date().toISOString().slice(0, 10);
    return (
      `Search results for "${query}" (today is ${today}):\n\n` +
      results.map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.content}`).join('\n\n')
    );
  } catch (err) {
    if (req.signal.aborted) throw err;
    return `Error: the search failed (${(err as Error).message}).`;
  }
}

function addUsage(a: Usage | undefined, b: Usage | undefined): Usage | undefined {
  if (!a) return b;
  if (!b) return a;
  const sum = (x?: number, y?: number) => (x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0));
  return { input: sum(a.input, b.input), output: sum(a.output, b.output), reasoning: sum(a.reasoning, b.reasoning), cached: sum(a.cached, b.cached) };
}

const MAX_ROUNDS = 5;

/** streamChat with the web search tool. If the model or gateway rejects tools, the request is retried once without them. */
export async function streamChatWithTools(req: ChatRequest, search: SearchFn): Promise<ChatResult> {
  const rounds: ToolRound[] = [];
  let usage: Usage | undefined;
  for (let i = 0; ; i++) {
    let r: ChatResult;
    let wrote = false;
    const onDelta: ChatRequest['onDelta'] = (d) => {
      if (d.content) wrote = true;
      req.onDelta(d);
    };
    try {
      r = await streamChat({ ...req, onDelta, tools: [WEB_SEARCH], toolChoice: i >= MAX_ROUNDS ? 'none' : 'auto', toolRounds: rounds });
    } catch (err) {
      const status = (err as ProviderError).status;
      if (i > 0 || req.signal.aborted || !(err instanceof ProviderError) || !status || status >= 500 || !/tool|function/i.test(err.message)) throw err;
      return streamChat(req);
    }
    usage = addUsage(usage, r.usage);
    if (!r.toolCalls?.length || i >= MAX_ROUNDS) return { ...r, usage, toolCalls: undefined, assistant: undefined };
    const results: ToolRound['results'] = [];
    for (const call of r.toolCalls) {
      const content = call.name === WEB_SEARCH.name ? await runWebSearch(call, req, search) : `Error: unknown tool "${call.name}".`;
      results.push({ id: call.id, name: call.name, content });
    }
    rounds.push({ assistant: r.assistant, calls: r.toolCalls, results });
    // Keep text from before and after the searches apart.
    if (wrote) req.onDelta({ content: '\n\n' });
  }
}
