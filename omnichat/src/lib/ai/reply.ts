// Turns one model's stream of deltas into a message version, with timing. Shared by the browser (replies it streams
// itself, and live updates of replies the server generates) and the server (background generation).
import { mergeSources } from './search';
import { streamChat } from './core';
import { streamChatWithTools, type SearchFn } from './tool-loop';
import type { ChatRequest, Delta } from './transport';
import type { MessageVersion, Provider, Source } from '../types';

/** Accumulates deltas; `snapshot()` is the version as it stands. */
export function replyAccumulator(head: Pick<MessageVersion, 'model' | 'providerId' | 'providerName'>) {
  const started = performance.now();
  let content = '';
  let reasoning = '';
  let firstAt = 0;
  let reasoningStart = 0;
  let reasoningEnd = 0;
  const sources: Source[] = [];
  let searching: string | undefined;
  let final: Partial<MessageVersion> | null = null;

  const snapshot = (): MessageVersion => ({
    ...head,
    content,
    reasoning: reasoning || undefined,
    sources: sources.length ? [...sources] : undefined,
    status: 'streaming',
    searching,
    ...final,
  });

  return {
    apply(d: Delta) {
      const now = performance.now();
      if (d.sources) mergeSources(sources, d.sources);
      if (d.searching) searching = d.searching;
      if (!firstAt && (d.content || d.reasoning)) firstAt = now;
      if (d.reasoning) {
        if (!reasoningStart) reasoningStart = now;
        reasoning += d.reasoning;
      }
      if (d.content) {
        if (reasoningStart && !reasoningEnd) reasoningEnd = now;
        content += d.content;
      }
    },
    snapshot,
    /** Ends the reply: `done` with a result, `aborted`, or `error`. Empty output counts as an error. */
    finish(end: Pick<MessageVersion, 'status' | 'error' | 'usage' | 'finishReason'>, emptyText: string): MessageVersion {
      const t = performance.now();
      final = {
        ...end,
        searching: undefined,
        durationMs: Math.round(t - started),
        firstTokenMs: firstAt ? Math.round(firstAt - started) : undefined,
        reasoningMs: reasoningStart ? Math.round((reasoningEnd || t) - reasoningStart) : undefined,
      };
      if (end.status === 'done' && !content.trim() && !reasoning.trim()) final = { ...final, status: 'error', error: emptyText };
      return snapshot();
    },
  };
}

export interface ReplyTarget {
  provider: Provider;
  model: string;
}

export interface RunReplyOptions {
  target: ReplyTarget;
  request: Omit<ChatRequest, 'provider' | 'model' | 'onDelta' | 'signal'>;
  signal: AbortSignal;
  /** When set, web search runs as a tool through this function. */
  search?: SearchFn;
  /** Error shown when the model returns nothing. */
  emptyText: string;
  onDelta?(d: Delta, v: MessageVersion): void;
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

/** Streams one model's reply; never throws. */
export async function runReply(o: RunReplyOptions): Promise<MessageVersion> {
  const { provider, model } = o.target;
  const acc = replyAccumulator({ model, providerId: provider.id, providerName: provider.name });
  const req: ChatRequest = {
    ...o.request,
    provider,
    model,
    signal: o.signal,
    onDelta: (d) => {
      acc.apply(d);
      o.onDelta?.(d, acc.snapshot());
    },
  };
  try {
    const result = await (o.search ? streamChatWithTools(req, o.search) : streamChat(req));
    return acc.finish({ status: 'done', usage: result.usage, finishReason: result.finishReason }, o.emptyText);
  } catch (err) {
    return acc.finish(o.signal.aborted ? { status: 'aborted' } : { status: 'error', error: errorText(err) }, o.emptyText);
  }
}
