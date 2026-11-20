// Web search as a tool: lets any model that supports function calling search the web through the server.
import { create } from 'zustand';
import { api } from '../api';
import { searchMode } from './search';
import type { SearchFn, WebResult } from './tool-loop';
import type { Provider } from '../types';

export interface WebSearchStatus {
  kind: string | null;
  url?: string;
  hasKey?: boolean;
  keyHint?: string;
  /** DeepSeek search without its own key: the name of the DeepSeek provider whose key it uses. */
  keyFrom?: string;
  /** Whether searches can run as configured. */
  ready?: boolean;
}

/** The account's search service (configured in Settings; the key stays on the server). */
export const useWebSearch = create<WebSearchStatus & { loaded: boolean }>(() => ({ kind: null, loaded: false }));

let loading: Promise<void> | null = null;
export function loadWebSearch(force = false): Promise<void> {
  if (!loading || force) {
    loading = api<WebSearchStatus>('/api/websearch/config').then(
      (s) => useWebSearch.setState({ ...s, loaded: true }),
      () => {
        loading = null;
      },
    );
  }
  return loading;
}

export function webSearchReady(s: WebSearchStatus = useWebSearch.getState()): boolean {
  return !!s.kind && !!s.ready;
}

/** How web search runs for a model: the provider's own search, the search tool, or not at all. */
export function effectiveSearchMode(p: Provider, model: string): ReturnType<typeof searchMode> | 'tool' {
  return searchMode(p, model) ?? (webSearchReady() ? 'tool' : null);
}

/** Searches through the account's search service on the server (for the web search tool). */
export const searchViaServer: SearchFn = async (query, signal) =>
  (await api<{ results: WebResult[] }>('/api/websearch', { body: { query }, signal })).results;
