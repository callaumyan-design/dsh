// OpenCode Go: one subscription, several wire protocols. Each model is routed to the protocol Go serves it on
// (Chat Completions, Responses, Anthropic Messages or Gemini), and every request carries a per-conversation session id.
import { GO_PREFIX, goProtocol, OPENCODE_GO_MODELS, opencodeGoRoot, type GoProtocol } from '../../../shared/opencode-go';
import { anthropicChat } from './anthropic';
import { geminiChat } from './gemini';
import { openaiChat, openaiModels } from './openai';
import { responsesChat } from './responses';
import type { ChatRequest, ChatResult, WireProvider } from './transport';
import type { ModelInfo, Provider } from '../types';
import { uid } from '../utils';

const WIRE_TYPE = { chat: 'openai', responses: 'openai', anthropic: 'anthropic', gemini: 'gemini' } as const;

// Requests outside a conversation (connection tests, model lists) still need a session id; one per page load is stable enough.
const pageSession = `catgpt-${uid()}`;

function wire(p: Provider, protocol: GoProtocol | 'models', sessionId?: string): WireProvider {
  return {
    ...p,
    presetId: 'opencode-go',
    type: protocol === 'models' ? 'openai' : WIRE_TYPE[protocol],
    baseUrl: opencodeGoRoot(p.baseUrl),
    // Each protocol uses its native credential header (the proxy picks the same one from the path).
    authStyle: undefined,
    useResponsesApi: protocol === 'responses' || undefined,
    pathPrefix: protocol === 'models' ? '/v1' : GO_PREFIX[protocol],
    requestHeaders: { 'x-opencode-session': sessionId || pageSession },
  };
}

export function opencodeGoChat(req: ChatRequest): Promise<ChatResult> {
  const model = req.model.replace(/^opencode-go\//, '');
  const protocol = goProtocol(model);
  const r = { ...req, model, provider: wire(req.provider, protocol, req.sessionId) };
  switch (protocol) {
    case 'anthropic':
      return anthropicChat(r);
    case 'gemini':
      return geminiChat(r);
    case 'responses':
      return responsesChat(r);
    default:
      return openaiChat(r);
  }
}

export async function opencodeGoModels(p: Provider): Promise<ModelInfo[]> {
  const list = await openaiModels(wire(p, 'models'));
  return list.map((m) => ({ id: m.id, name: OPENCODE_GO_MODELS[m.id]?.name ?? m.name }));
}
