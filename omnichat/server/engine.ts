// The browser's protocol adapters, reused by the server for background generation.
import { composeMessage } from '../src/lib/ai/background';
import { streamChat } from '../src/lib/ai/core';
import { runReply } from '../src/lib/ai/reply';
import { cleanTitle, titlePrompt } from '../src/lib/ai/title';
import type { GenerationEngine } from './generation';

export const engine: GenerationEngine = { runReply, streamChat, composeMessage, titlePrompt, cleanTitle };
