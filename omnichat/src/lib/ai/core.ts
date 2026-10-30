// Protocol dispatch shared by the browser and the server (background generation). Nothing here touches browser APIs.
import { anthropicChat } from './anthropic';
import { geminiChat } from './gemini';
import { openaiChat } from './openai';
import { opencodeGoChat } from './opencode-go';
import { isOpencodeGo } from '../../../shared/opencode-go';
import { responsesChat } from './responses';
import type { ChatRequest, ChatResult } from './transport';

export function streamChat(req: ChatRequest): Promise<ChatResult> {
  if (isOpencodeGo(req.provider)) return opencodeGoChat(req);
  switch (req.provider.type) {
    case 'anthropic':
      return anthropicChat(req);
    case 'gemini':
      return geminiChat(req);
    default:
      return req.provider.useResponsesApi ? responsesChat(req) : openaiChat(req);
  }
}
