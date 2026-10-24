import { anthropicChat, anthropicModels } from './anthropic';
import { geminiChat, geminiModels } from './gemini';
import { openaiChat, openaiModels } from './openai';
import { responsesChat } from './responses';
import type { ChatRequest, ChatResult } from './transport';
import type { ModelInfo, Provider } from '../types';

export type { ChatRequest, ChatResult, ChatTurn, Delta } from './transport';
export { ProviderError, forgetProviderKey } from './transport';

export function streamChat(req: ChatRequest): Promise<ChatResult> {
  switch (req.provider.type) {
    case 'anthropic':
      return anthropicChat(req);
    case 'gemini':
      return geminiChat(req);
    default:
      return req.provider.useResponsesApi ? responsesChat(req) : openaiChat(req);
  }
}

export async function listModels(p: Provider): Promise<ModelInfo[]> {
  const list = p.type === 'anthropic' ? await anthropicModels(p) : p.type === 'gemini' ? await geminiModels(p) : await openaiModels(p);
  const seen = new Set<string>();
  return list
    .filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Sends a tiny request and stops at the first token. Resolves with latency in ms. */
export async function testProvider(p: Provider, model: string): Promise<{ ms: number; sample: string }> {
  const controller = new AbortController();
  const started = performance.now();
  let sample = '';
  let firstAt = 0;
  try {
    await streamChat({
      provider: p,
      model,
      messages: [{ role: 'user', content: 'Reply with the single word: OK' }],
      params: { reasoningEffort: 'default' },
      signal: controller.signal,
      onDelta: (d) => {
        if (!firstAt) firstAt = performance.now();
        sample += d.content ?? '';
        if (sample.length > 0) controller.abort();
      },
    });
  } catch (err) {
    if (!controller.signal.aborted) throw err;
  }
  return { ms: Math.round((firstAt || performance.now()) - started), sample: sample.trim() };
}
