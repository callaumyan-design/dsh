// Chat runtime: sending, streaming, regenerating and titling conversations.
import { create } from 'zustand';
import { streamChat } from '@/lib/ai';
import { localLocks } from '@/lib/sync';
import { throttle, truncate, uid } from '@/lib/utils';
import type { Attachment, Conversation, Message, MessageVersion, Provider, Source } from '@/lib/types';
import { mergeSources } from '@/lib/ai/search';
import type { ChatTurn } from '@/lib/ai';
import { t } from '@/i18n';
import {
  deleteMessages,
  getMessages,
  saveConversation,
  saveMessage,
  setLocalMessage,
  updateConversation,
  useData,
} from './data';
import { openConversation, openSettings, toast, useUI } from './ui';

interface ChatState {
  streaming: Record<string, { messageId: string; controller: AbortController }>;
}

export const useChat = create<ChatState>(() => ({ streaming: {} }));

export function sortedProviders(): Provider[] {
  return Object.values(useData.getState().providers).sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.createdAt ?? 0) - (b.createdAt ?? 0),
  );
}

/** Picks the provider/model to use, falling back to the default and then to the first configured model. */
export function resolveTarget(providerId?: string, model?: string): { provider: Provider; model: string } | null {
  const { providers, settings } = useData.getState();
  const usable = (p?: Provider): p is Provider => !!p && p.enabled !== false;
  const p = providerId ? providers[providerId] : undefined;
  if (usable(p) && model) return { provider: p, model };
  const dp = settings.defaultProviderId ? providers[settings.defaultProviderId] : undefined;
  if (usable(dp) && settings.defaultModel) return { provider: dp, model: settings.defaultModel };
  for (const pr of sortedProviders()) {
    if (!usable(pr)) continue;
    const m = pr.models.find((x) => !x.hidden);
    if (m) return { provider: pr, model: m.id };
  }
  return null;
}

function nextTimestamp(conversationId: string) {
  const list = getMessages(conversationId);
  const last = list[list.length - 1];
  return Math.max(Date.now(), last ? last.createdAt + 1 : 0);
}

function snapshot(m: Message): MessageVersion {
  return {
    content: m.content,
    reasoning: m.reasoning,
    model: m.model,
    providerId: m.providerId,
    providerName: m.providerName,
    usage: m.usage,
    status: m.status,
    error: m.error,
    durationMs: m.durationMs,
    firstTokenMs: m.firstTokenMs,
    reasoningMs: m.reasoningMs,
    finishReason: m.finishReason,
    sources: m.sources,
  };
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

export function newConversation(opts: Partial<Conversation> = {}): Conversation {
  const { settings } = useData.getState();
  const draft = useUI.getState().draft;
  const target = resolveTarget(opts.providerId ?? draft.providerId, opts.model ?? draft.model);
  const conv: Conversation = {
    id: uid(),
    title: t('chat.newChat'),
    providerId: target?.provider.id,
    model: target?.model,
    systemPrompt: draft.systemPrompt ?? settings.defaultSystemPrompt,
    promptId: draft.promptId,
    params: settings.defaultParams || draft.webSearch ? { ...settings.defaultParams, ...(draft.webSearch ? { webSearch: true } : {}) } : undefined,
    createdAt: Date.now(),
    lastMessageAt: Date.now(),
    ...opts,
  };
  saveConversation(conv);
  useData.setState((s) => ({
    messages: { ...s.messages, [conv.id]: s.messages[conv.id] ?? [] },
    messagesLoaded: { ...s.messagesLoaded, [conv.id]: true },
  }));
  return conv;
}

export interface Target {
  provider: Provider;
  model: string;
}

export interface ModelRef {
  providerId?: string;
  model?: string;
}

/** A specific provider/model, if that provider exists and is enabled. */
export function exactTarget(ref: ModelRef): Target | null {
  const p = ref.providerId ? useData.getState().providers[ref.providerId] : undefined;
  return p && p.enabled !== false && ref.model ? { provider: p, model: ref.model } : null;
}

/** Sends a user message. `compare` lists extra models that answer the same message in parallel. */
export async function sendMessage(text: string, attachments: Attachment[], compare: ModelRef[] = []): Promise<boolean> {
  const ui = useUI.getState();
  let conv = ui.activeId ? useData.getState().conversations[ui.activeId] : undefined;
  if (!conv) {
    const target = resolveTarget(ui.draft.providerId, ui.draft.model);
    if (!target) {
      toast(t('chat.noProvider'), 'error');
      openSettings('providers');
      return false;
    }
    conv = newConversation({ title: truncate(text || attachments[0]?.name || t('chat.newChat'), 40) });
    useUI.setState({ draft: {} });
    openConversation(conv.id);
  } else if (useChat.getState().streaming[conv.id]) {
    return false;
  }
  const createdAt = nextTimestamp(conv.id);
  saveMessage({
    id: uid(),
    conversationId: conv.id,
    role: 'user',
    content: text,
    attachments: attachments.length ? attachments : undefined,
    createdAt,
  });
  updateConversation(conv.id, { lastMessageAt: createdAt });
  void generate(conv.id, { compare });
  return true;
}

export function stopGeneration(conversationId: string) {
  useChat.getState().streaming[conversationId]?.controller.abort();
}

/** Fills {{date}}, {{time}}, {{datetime}}, {{weekday}}, {{model}}, {{provider}}, {{language}}, {{timezone}}. */
export function renderPromptVars(text: string, target?: Target): string {
  if (!text.includes('{{')) return text;
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const vars: Record<string, string> = {
    date,
    time,
    datetime: `${date} ${time}`,
    weekday: now.toLocaleDateString(navigator.language, { weekday: 'long' }),
    model: target?.model ?? '',
    provider: target?.provider.name ?? '',
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => vars[k.toLowerCase()] ?? m);
}

function buildContext(conv: Conversation, history: Message[]): ChatTurn[] {
  let context = history.filter((m) => m.status !== 'error' && m.status !== 'streaming' && (m.content.trim() || m.attachments?.length));
  const count = conv.params?.contextCount;
  if (count && count > 0) context = context.slice(-count);
  while (context.length && context[0].role === 'assistant') context = context.slice(1);
  return context.map((m) => ({ role: m.role, content: m.content, attachments: m.attachments }));
}

/** Streams one model's reply, reporting progress; never throws. */
async function streamOne(
  target: Target,
  conv: Conversation,
  turns: ChatTurn[],
  signal: AbortSignal,
  onUpdate: (v: MessageVersion) => void,
): Promise<MessageVersion> {
  const v: MessageVersion = { content: '', model: target.model, providerId: target.provider.id, providerName: target.provider.name, status: 'streaming' };
  const started = performance.now();
  let content = '';
  let reasoning = '';
  let firstAt = 0;
  let reasoningStart = 0;
  let reasoningEnd = 0;
  const sources: Source[] = [];
  let searching: string | undefined;
  const snap = (): MessageVersion => ({
    ...v,
    content,
    reasoning: reasoning || undefined,
    sources: sources.length ? [...sources] : undefined,
    searching: v.status === 'streaming' ? searching : undefined,
  });
  try {
    const result = await streamChat({
      provider: target.provider,
      model: target.model,
      system: renderPromptVars(conv.systemPrompt?.trim() ?? '', target) || undefined,
      messages: turns,
      params: { ...conv.params },
      signal,
      sessionId: conv.id,
      onDelta: (d) => {
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
        onUpdate(snap());
      },
    });
    Object.assign(v, { status: 'done', usage: result.usage, finishReason: result.finishReason });
    if (!content.trim() && !reasoning.trim()) Object.assign(v, { status: 'error', error: t('chat.emptyResponse') });
  } catch (err) {
    Object.assign(v, { status: signal.aborted ? 'aborted' : 'error', error: signal.aborted ? undefined : errorText(err) });
  }
  const end = performance.now();
  return {
    ...snap(),
    durationMs: Math.round(end - started),
    firstTokenMs: firstAt ? Math.round(firstAt - started) : undefined,
    reasoningMs: reasoningStart ? Math.round((reasoningEnd || end) - reasoningStart) : undefined,
  };
}

/**
 * Generates the assistant reply for the latest turn, or regenerates `regenerateId`.
 * With `compare`, several models answer at once; each answer becomes a version of the same message.
 */
export async function generate(conversationId: string, opts: { regenerateId?: string; compare?: ModelRef[] } = {}) {
  if (useChat.getState().streaming[conversationId]) return;
  const conv = useData.getState().conversations[conversationId];
  if (!conv) return;
  const primary = resolveTarget(conv.providerId, conv.model);
  if (!primary) {
    toast(t('chat.noProvider'), 'error');
    openSettings('providers');
    return;
  }
  const targets: Target[] = [primary];
  if (!opts.regenerateId) {
    for (const ref of opts.compare ?? []) {
      const x = exactTarget(ref);
      if (x && !targets.some((y) => y.provider.id === x.provider.id && y.model === x.model)) targets.push(x);
    }
  }

  const all = getMessages(conversationId);
  let history: Message[];
  let base: Message;
  let prior: MessageVersion[] = [];
  if (opts.regenerateId) {
    const idx = all.findIndex((m) => m.id === opts.regenerateId);
    if (idx < 0) return;
    const existing = all[idx];
    history = all.slice(0, idx);
    prior = existing.versions?.length ? [...existing.versions] : [];
    if (prior.length) prior[existing.versionIndex ?? prior.length - 1] = snapshot(existing);
    else prior.push(snapshot(existing));
    base = { id: existing.id, conversationId, role: 'assistant', createdAt: existing.createdAt, content: '' };
  } else {
    history = all;
    base = { id: uid(), conversationId, role: 'assistant', createdAt: nextTimestamp(conversationId), content: '' };
  }
  const turns = buildContext(conv, history);

  const live: MessageVersion[] = targets.map((x) => ({
    content: '',
    model: x.model,
    providerId: x.provider.id,
    providerName: x.provider.name,
    status: 'streaming',
  }));
  const multi = prior.length > 0 || targets.length > 1;
  const firstLive = prior.length;
  let shown = false;
  // The user may switch version tabs while streaming; respect the selection stored on the message.
  const compose = (): Message => {
    if (!multi) return { ...base, ...live[0] };
    const versions = [...prior, ...live];
    const current = shown ? getMessages(conversationId).find((m) => m.id === base.id) : undefined;
    let vi = current?.versionIndex ?? firstLive;
    if (vi < 0 || vi >= versions.length) vi = firstLive;
    shown = true;
    return { ...base, ...versions[vi], createdAt: base.createdAt, versions, versionIndex: vi };
  };

  const lockKey = `message:${base.id}`;
  localLocks.add(lockKey);
  const controller = new AbortController();
  useChat.setState((s) => ({ streaming: { ...s.streaming, [conversationId]: { messageId: base.id, controller } } }));
  setLocalMessage(compose());
  const render = throttle(() => setLocalMessage(compose()), 60);

  await Promise.all(
    targets.map((x, i) =>
      streamOne(x, conv, turns, controller.signal, (v) => {
        live[i] = v;
        render();
      }).then((v) => {
        live[i] = v;
      }),
    ),
  );
  render.cancel();
  const final = compose();

  // The conversation (or this message) may have been deleted while streaming.
  const stillExists = !!useData.getState().conversations[conversationId] && getMessages(conversationId).some((m) => m.id === base.id);
  if (stillExists) saveMessage(final);
  localLocks.delete(lockKey);
  useChat.setState((s) => {
    const streaming = { ...s.streaming };
    delete streaming[conversationId];
    return { streaming };
  });
  if (useData.getState().conversations[conversationId]) updateConversation(conversationId, { lastMessageAt: Date.now() });
  if (!opts.regenerateId && live.some((v) => v.status === 'done')) void autoTitle(conversationId);
}

export function regenerate(m: Message) {
  void generate(m.conversationId, { regenerateId: m.id });
}

/** Shows another version while it is still streaming (saved when generation ends). */
export function selectVersionLocal(m: Message, index: number) {
  const v = m.versions?.[index];
  if (!v) return;
  setLocalMessage({ ...m, ...v, createdAt: m.createdAt, versions: m.versions, versionIndex: index });
}

export function switchVersion(m: Message, index: number) {
  if (!m.versions?.length || index < 0 || index >= m.versions.length) return;
  const versions = [...m.versions];
  versions[m.versionIndex ?? versions.length - 1] = snapshot(m);
  saveMessage({ ...m, ...versions[index], createdAt: m.createdAt, versions, versionIndex: index });
}

export async function editMessage(m: Message, content: string, resend: boolean) {
  if (!resend) {
    saveMessage({ ...m, content });
    return;
  }
  stopGeneration(m.conversationId);
  const all = getMessages(m.conversationId);
  const idx = all.findIndex((x) => x.id === m.id);
  saveMessage({ ...m, content });
  deleteMessages(
    m.conversationId,
    all.slice(idx + 1).map((x) => x.id),
  );
  // Wait for an aborted stream to settle before starting a new one.
  for (let i = 0; i < 50 && useChat.getState().streaming[m.conversationId]; i++) await new Promise((r) => setTimeout(r, 20));
  await generate(m.conversationId);
}

/** Re-runs the last user turn (used for "retry" after an error). */
export function retryLast(conversationId: string) {
  const all = getMessages(conversationId);
  const last = all[all.length - 1];
  if (last?.role === 'assistant') regenerate(last);
  else void generate(conversationId);
}

export function deleteMessage(m: Message) {
  if (useChat.getState().streaming[m.conversationId]?.messageId === m.id) stopGeneration(m.conversationId);
  deleteMessages(m.conversationId, [m.id]);
}

export function forkConversation(m: Message) {
  const conv = useData.getState().conversations[m.conversationId];
  if (!conv) return;
  const all = getMessages(m.conversationId);
  const upto = all.slice(0, all.findIndex((x) => x.id === m.id) + 1);
  const fork = newConversation({
    title: `${conv.title} (${t('chat.fork')})`,
    providerId: conv.providerId,
    model: conv.model,
    systemPrompt: conv.systemPrompt,
    params: conv.params,
    promptId: conv.promptId,
    titleGenerated: true,
  });
  for (const x of upto) saveMessage({ ...x, id: uid(), conversationId: fork.id, syncedAt: undefined });
  openConversation(fork.id);
}

export function clearConversation(conversationId: string) {
  stopGeneration(conversationId);
  deleteMessages(
    conversationId,
    getMessages(conversationId).map((m) => m.id),
  );
}

function cleanTitle(s: string) {
  return s
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/^\s*(title|标题)\s*[:：]\s*/i, '')
    .replace(/[\s"'“”‘’《》「」*#`]+/g, (m) => (/\s/.test(m) ? ' ' : ''))
    .replace(/[。.!！?？,，;；:：]+$/, '')
    .trim()
    .slice(0, 50);
}

export async function autoTitle(conversationId: string, force = false) {
  const { settings, conversations } = useData.getState();
  const conv = conversations[conversationId];
  if (!conv || (!force && (!settings.autoTitle || conv.titleGenerated))) return;
  const msgs = getMessages(conversationId);
  const user = msgs.find((m) => m.role === 'user');
  const reply = msgs.find((m) => m.role === 'assistant' && m.content);
  if (!user || !reply) return;
  const target = settings.titleModel ? resolveTarget(settings.titleProviderId, settings.titleModel) : resolveTarget(conv.providerId, conv.model);
  if (!target) return;
  const prompt =
    `Write a short title for the conversation below, in the same language the user wrote in ` +
    `(at most 12 Chinese characters or 6 English words). Reply with the title only — no quotes, no punctuation at the end.\n\n` +
    `User: ${truncate(user.content || user.attachments?.map((a) => a.name).join(', ') || '', 800)}\n\nAssistant: ${truncate(reply.content, 800)}`;
  let out = '';
  try {
    await streamChat({
      provider: target.provider,
      model: target.model,
      messages: [{ role: 'user', content: prompt }],
      params: { reasoningEffort: 'default' },
      signal: AbortSignal.timeout(90_000),
      sessionId: conv.id,
      onDelta: (d) => {
        out += d.content ?? '';
      },
    });
  } catch {
    return;
  }
  const title = cleanTitle(out);
  if (title && useData.getState().conversations[conversationId]) updateConversation(conversationId, { title, titleGenerated: true });
}
