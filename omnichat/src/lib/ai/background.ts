// Background generation: the server streams the reply and saves it, so it finishes even if every page is closed.
// Pages that are open follow it live over /api/generate/<conversationId>. Shared by the browser and the server.
import { mergeSources } from './search';
import type { ChatTurn, Delta } from './transport';
import type { ChatParams, Message, MessageVersion } from '../types';

export interface GenerateTarget {
  providerId: string;
  model: string;
  /** System prompt for this model (prompt variables such as {{model}} are filled per model). */
  system?: string;
  /** Run web search as a tool through the account's search service. */
  searchTool?: boolean;
}

export interface GenerateRequest {
  conversationId: string;
  messageId: string;
  createdAt: number;
  /** Earlier versions of a reply being regenerated (the one shown refreshed). */
  prior?: MessageVersion[];
  targets: GenerateTarget[];
  messages: ChatTurn[];
  params: ChatParams;
  /** Name the chat afterwards with this model (only when it has no generated title yet). */
  title?: { providerId: string; model: string };
  /** Error shown when a model returns nothing, in the user's language. */
  emptyText: string;
}

/** A running reply as a newly attached page first sees it. */
export interface JobSnapshot {
  conversationId: string;
  messageId: string;
  createdAt: number;
  prior: MessageVersion[];
  live: MessageVersion[];
}

/** Server-sent events of /api/generate (event name → data). */
export interface JobEvents {
  init: JobSnapshot;
  /** A streamed piece of model `t`'s reply. */
  delta: { t: number; d: Delta };
  /** Model `t` finished. */
  version: { t: number; v: MessageVersion };
  /** Every model finished and the message was saved (null when it was discarded). */
  done: { message: Message | null; updatedAt: number };
  /** The chat was named. */
  title: { title: string };
}

/** The message a job produces: one version per model, after any earlier versions of a regenerated reply. */
export function composeMessage(job: JobSnapshot, versionIndex?: number): Message {
  const base: Message = { id: job.messageId, conversationId: job.conversationId, role: 'assistant', createdAt: job.createdAt, content: '' };
  if (!job.prior.length && job.live.length === 1) return { ...base, ...job.live[0], createdAt: job.createdAt };
  const versions = [...job.prior, ...job.live];
  let vi = versionIndex ?? job.prior.length;
  if (vi < 0 || vi >= versions.length) vi = job.prior.length;
  return { ...base, ...versions[vi], createdAt: job.createdAt, versions, versionIndex: vi };
}

/** Applies a streamed delta to a live version (as shown while streaming). */
export function applyDelta(v: MessageVersion, d: Delta): MessageVersion {
  const next = { ...v };
  if (d.content) next.content = (v.content ?? '') + d.content;
  if (d.reasoning) next.reasoning = (v.reasoning ?? '') + d.reasoning;
  if (d.sources) next.sources = mergeSources([...(v.sources ?? [])], d.sources);
  if (d.searching) next.searching = d.searching;
  return next;
}
