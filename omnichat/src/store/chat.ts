// Chat runtime: sending, streaming, regenerating and titling conversations.
import { create } from 'zustand';
import { streamChat } from '@/lib/ai';
import { authFetch, api } from '@/lib/api';
import { flushNow, hasPending, localLocks, pull, pullMessages } from '@/lib/sync';
import { throttle, truncate, uid } from '@/lib/utils';
import type { Attachment, Conversation, Message, MessageVersion, Project, Provider } from '@/lib/types';
import { effectiveSearchMode, searchViaServer } from '@/lib/ai/tools';
import type { ChatTurn } from '@/lib/ai';
import { attachmentsAsText } from '@/lib/ai/transport';
import { runReply } from '@/lib/ai/reply';
import { readSSE } from '@/lib/ai/sse';
import { cleanTitle, titlePrompt } from '@/lib/ai/title';
import { applyDelta, composeMessage, type GenerateRequest, type JobEvents, type JobSnapshot } from '@/lib/ai/background';
import { t } from '@/i18n';
import {
  applyServerMessage,
  deleteMessages,
  dropLocalMessage,
  getMessages,
  saveConversation,
  saveMessage,
  setLocalMessage,
  updateConversation,
  useData,
} from './data';
import { useAuth } from './auth';
import { openConversation, openSettings, toast, useUI } from './ui';

interface Streaming {
  messageId: string;
  controller: AbortController;
  /** The server generates this reply; the page only follows it, so closing it doesn't stop the reply. */
  remote?: boolean;
}

interface ChatState {
  streaming: Record<string, Streaming>;
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
    params:
      settings.defaultParams || draft.webSearch || draft.reasoningEffort
        ? {
            ...settings.defaultParams,
            ...(draft.webSearch ? { webSearch: true } : {}),
            ...(draft.reasoningEffort ? { reasoningEffort: draft.reasoningEffort } : {}),
          }
        : undefined,
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
    const project = ui.projectId ? useData.getState().projects[ui.projectId] : undefined;
    conv = newConversation({ title: truncate(text || attachments[0]?.name || t('chat.newChat'), 40), projectId: project?.id });
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

/** Resolves once the conversation has no reply streaming (or after `ms`). */
function settled(conversationId: string, ms = 10_000): Promise<void> {
  if (!useChat.getState().streaming[conversationId]) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      unsub();
      resolve();
    };
    const timer = setTimeout(done, ms);
    const unsub = useChat.subscribe((s) => {
      if (!s.streaming[conversationId]) done();
    });
  });
}

/**
 * Stops the reply being generated in a conversation. With `discard`, a reply generated on the server is dropped
 * instead of saved (the caller deletes the message). Resolves when it has stopped.
 */
export function stopGeneration(conversationId: string, opts: { discard?: boolean } = {}): Promise<void> {
  const s = useChat.getState().streaming[conversationId];
  if (!s) return Promise.resolve();
  if (!s.remote) {
    s.controller.abort();
    return settled(conversationId);
  }
  return api<{ stopped: boolean }>(`/api/generate/${encodeURIComponent(conversationId)}/stop`, { body: { discard: !!opts.discard } })
    .then((r) => {
      // Nothing running on the server: stop following.
      if (!r.stopped) s.controller.abort();
    })
    .catch(() => s.controller.abort())
    .then(() => settled(conversationId))
    .then(() => {
      // The server didn't confirm in time: let go of the reply locally.
      if (useChat.getState().streaming[conversationId]?.controller === s.controller) s.controller.abort();
    });
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

export function projectOf(conv: Conversation): Project | undefined {
  return conv.projectId ? useData.getState().projects[conv.projectId] : undefined;
}

/** Project instructions, then the chat's own system prompt, then the project's text files. */
function buildSystem(conv: Conversation, target: Target): string | undefined {
  const project = projectOf(conv);
  const parts = [project?.instructions, conv.systemPrompt].map((s) => renderPromptVars(s?.trim() ?? '', target)).filter(Boolean);
  const files = attachmentsAsText(project?.files);
  if (files) {
    parts.push(
      `The user has attached the following files to the project "${project!.name}" as reference material for this conversation:\n\n` +
        `<project_files>\n${files}\n</project_files>`,
    );
  }
  return parts.join('\n\n') || undefined;
}

function buildContext(conv: Conversation, history: Message[]): ChatTurn[] {
  let context = history.filter((m) => m.status !== 'error' && m.status !== 'streaming' && (m.content.trim() || m.attachments?.length));
  const count = conv.params?.contextCount;
  if (count && count > 0) context = context.slice(-count);
  while (context.length && context[0].role === 'assistant') context = context.slice(1);
  const turns: ChatTurn[] = context.map((m) => ({ role: m.role, content: m.content, attachments: m.attachments }));
  // Project images and PDFs ride along with the first turn that is sent, so they stay in view however long the chat gets.
  const media = projectOf(conv)?.files?.filter((f) => f.kind !== 'text') ?? [];
  if (media.length && turns[0]) turns[0] = { ...turns[0], attachments: [...media, ...(turns[0].attachments ?? [])] };
  return turns;
}

/** Whether replies can be generated on the server, so they finish even if the page is closed. */
function backgroundGeneration(): boolean {
  return !!useAuth.getState().status?.features?.backgroundGeneration;
}

/** Web search runs as a tool (through the account's search service) for models without their own search. */
function usesSearchTool(conv: Conversation, target: Target): boolean {
  return !!conv.params?.webSearch && effectiveSearchMode(target.provider, target.model) === 'tool';
}

function titleTarget(conv: Conversation): Target | null {
  const { settings } = useData.getState();
  return settings.titleModel ? resolveTarget(settings.titleProviderId, settings.titleModel) : resolveTarget(conv.providerId, conv.model);
}

interface Follower {
  controller: AbortController;
  /** The message as it stands (respecting the version tab the user picked while streaming). */
  compose(): Message;
  render: ReturnType<typeof throttle<[]>>;
  /** Stops showing the reply as streaming. */
  end(): void;
}

/** Shows a reply while it streams. The message stays local (not synced) and remote copies can't overwrite it meanwhile. */
function follow(job: JobSnapshot, remote: boolean): Follower {
  const lockKey = `message:${job.messageId}`;
  localLocks.add(lockKey);
  const controller = new AbortController();
  useChat.setState((s) => ({ streaming: { ...s.streaming, [job.conversationId]: { messageId: job.messageId, controller, remote } } }));
  let shown = false;
  // The user may switch version tabs while streaming; respect the selection stored on the message.
  const compose = () => {
    const current = shown ? getMessages(job.conversationId).find((m) => m.id === job.messageId) : undefined;
    shown = true;
    return composeMessage(job, current?.versionIndex);
  };
  setLocalMessage(compose());
  const render = throttle(() => setLocalMessage(compose()), 60);
  let ended = false;
  return {
    controller,
    compose,
    render,
    end() {
      if (ended) return;
      ended = true;
      render.cancel();
      localLocks.delete(lockKey);
      useChat.setState((s) => {
        if (s.streaming[job.conversationId]?.controller !== controller) return s;
        const streaming = { ...s.streaming };
        delete streaming[job.conversationId];
        return { streaming };
      });
    },
  };
}

/** The page streams the reply itself (Cloudflare Workers, or providers in direct mode). It stops if the page closes. */
async function generateHere(conv: Conversation, job: JobSnapshot, targets: Target[], turns: ChatTurn[], withTitle: boolean) {
  const f = follow(job, false);
  await Promise.all(
    targets.map((x, i) =>
      runReply({
        target: x,
        request: { system: buildSystem(conv, x), messages: turns, params: { ...conv.params }, sessionId: conv.id },
        signal: f.controller.signal,
        search: usesSearchTool(conv, x) ? searchViaServer : undefined,
        emptyText: t('chat.emptyResponse'),
        onDelta: (_d, v) => {
          job.live[i] = v;
          f.render();
        },
      }).then((v) => {
        job.live[i] = v;
      }),
    ),
  );
  f.render.cancel();
  const final = f.compose();
  // The conversation (or this message) may have been deleted while streaming.
  const stillExists = !!useData.getState().conversations[conv.id] && getMessages(conv.id).some((m) => m.id === job.messageId);
  if (stillExists) saveMessage(final);
  f.end();
  if (useData.getState().conversations[conv.id]) updateConversation(conv.id, { lastMessageAt: Date.now() });
  if (withTitle && job.live.some((v) => v.status === 'done')) void autoTitle(conv.id);
}

/** The server generates and saves the reply; the page follows it live. */
async function generateOnServer(conv: Conversation, job: JobSnapshot, targets: Target[], turns: ChatTurn[], withTitle: boolean) {
  const f = follow(job, true);
  const { settings } = useData.getState();
  const title = withTitle && settings.autoTitle && !conv.titleGenerated ? titleTarget(conv) : null;
  const titleOnServer = title && title.provider.mode !== 'direct' ? title : null;
  const body: GenerateRequest = {
    conversationId: conv.id,
    messageId: job.messageId,
    createdAt: job.createdAt,
    prior: job.prior,
    targets: targets.map((x) => ({ providerId: x.provider.id, model: x.model, system: buildSystem(conv, x), searchTool: usesSearchTool(conv, x) })),
    messages: turns,
    params: { ...conv.params },
    title: titleOnServer ? { providerId: titleOnServer.provider.id, model: titleOnServer.model } : undefined,
    emptyText: t('chat.emptyResponse'),
  };
  let res: Response | null = null;
  let error = '';
  try {
    // The server reads the provider config it has: send pending changes first.
    if (targets.some((x) => hasPending(`provider:${x.provider.id}`))) await flushNow();
    // Send the new message and chat along right away, in case the page is closed as soon as the reply starts.
    else void flushNow();
    res = await authFetch('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: f.controller.signal,
    });
    if (!res.ok && res.status !== 409) {
      error = ((await res.json().catch(() => null)) as { error?: string } | null)?.error || `${res.status} ${res.statusText}`;
      res = null;
    }
  } catch (err) {
    // The request may still have reached the server: look for the reply before giving up on it.
    if (!f.controller.signal.aborted) res = await authFetch(`/api/generate/${encodeURIComponent(conv.id)}`, { signal: f.controller.signal }).catch(() => null);
    if (!res?.ok) {
      res = null;
      error = f.controller.signal.aborted ? '' : (err as Error).message || t('msg.failed');
    }
  }
  if (!res) {
    // Never started: keep the failure on the message, like a reply that failed in the browser.
    job.live = job.live.map((v) => ({ ...v, status: error ? 'error' : 'aborted', error: error || undefined }));
    const final = f.compose();
    f.end();
    if (useData.getState().conversations[conv.id] && getMessages(conv.id).some((m) => m.id === job.messageId)) saveMessage(final);
    return;
  }
  if (res.status === 409) {
    // Another device is already generating a reply in this chat: drop this one and show that one instead.
    f.end();
    dropLocalMessage(conv.id, job.messageId);
    void attach(conv.id, '');
    return;
  }
  const done = await track(conv.id, res, { job, f });
  if (done && withTitle && title && !titleOnServer) void autoTitle(conv.id);
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true });
  });

function whenVisible(signal: AbortSignal): Promise<void> {
  if (document.visibilityState === 'visible' || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const h = () => {
      if (document.visibilityState !== 'visible' && !signal.aborted) return;
      document.removeEventListener('visibilitychange', h);
      resolve();
    };
    document.addEventListener('visibilitychange', h);
    signal.addEventListener('abort', h, { once: true });
  });
}

/**
 * Follows a reply the server is generating until it is done, re-connecting whenever the connection drops (a phone
 * switching apps, a flaky network). Returns whether the reply finished while followed. Starts following on the
 * stream's first event when `started` is not given.
 */
async function track(conversationId: string, first: Response | null, started?: { job: JobSnapshot; f: Follower }): Promise<boolean> {
  let job = started?.job ?? null;
  let f = started?.f ?? null;
  const signal = () => f?.controller.signal ?? new AbortController().signal;
  let res = first;
  let delay = 1000;
  let finished = false;
  try {
    for (;;) {
      if (res?.ok) {
        try {
          for await (const ev of readSSE(res)) {
            const name = ev.event as keyof JobEvents;
            let data: JobEvents[keyof JobEvents];
            try {
              data = JSON.parse(ev.data);
            } catch {
              continue;
            }
            if (name === 'init') {
              const snap = data as JobEvents['init'];
              if (job && f && snap.messageId !== job.messageId) {
                // The reply followed so far ended unseen and another one started: fetch the first, follow the second.
                f.end();
                void pullMessages(conversationId);
                job = null;
              }
              if (!job || !f) {
                job = { ...snap };
                f = follow(job, true);
              } else {
                job.prior = snap.prior;
                job.live = snap.live;
                f.render();
              }
            } else if (name === 'delta' && job && f) {
              const { t: i, d } = data as JobEvents['delta'];
              if (job.live[i]) job.live[i] = applyDelta(job.live[i], d);
              f.render();
            } else if (name === 'version' && job && f) {
              const { t: i, v } = data as JobEvents['version'];
              job.live[i] = v;
              f.render();
            } else if (name === 'done' && f) {
              const { message, updatedAt } = data as JobEvents['done'];
              finished = true;
              const picked = f.compose().versionIndex;
              f.end();
              if (message) {
                applyServerMessage(message, updatedAt);
                // Keep the version tab the user picked while it streamed.
                const vi = picked ?? message.versionIndex;
                const v = vi !== undefined && vi !== message.versionIndex ? message.versions?.[vi] : undefined;
                if (v) saveMessage({ ...message, ...v, createdAt: message.createdAt, versions: message.versions, versionIndex: vi });
              }
              void pull();
            } else if (name === 'title') {
              void pull();
            }
          }
        } catch {
          /* connection dropped, or stopped following */
        }
        delay = 1000;
      } else if (res && res.status !== 409 && res.status < 500) {
        break; // 404: nothing running any more
      }
      // Nothing to show yet (the stream broke before its first event): leave it to sync.
      if (finished || signal().aborted || !f) break;
      await sleep(delay, signal());
      await whenVisible(signal());
      if (signal().aborted) break;
      delay = Math.min(delay * 2, 30_000);
      res = await authFetch(`/api/generate/${encodeURIComponent(conversationId)}`, { signal: signal() }).catch(() => null);
    }
  } finally {
    if (!finished) {
      // Stopped following before the end: fetch whatever the server saved.
      f?.end();
      void pullMessages(conversationId);
    }
  }
  return finished;
}

const attachTries = new Map<string, number>();

/** Follows a reply started elsewhere (another device, or before this page was reloaded). */
async function attach(conversationId: string, messageId: string) {
  const key = `${conversationId}:${messageId}`;
  if (useChat.getState().streaming[conversationId] || Date.now() - (attachTries.get(key) ?? 0) < 30_000) return;
  attachTries.set(key, Date.now());
  const res = await authFetch(`/api/generate/${encodeURIComponent(conversationId)}`).catch(() => null);
  if (!res || useChat.getState().streaming[conversationId]) {
    void res?.body?.cancel();
    return;
  }
  if (!res.ok) {
    // Finished meanwhile: the saved copy is newer than the one shown.
    if (res.status === 404) void pullMessages(conversationId);
    return;
  }
  await track(conversationId, res);
}

// A reply that is still being generated shows up through sync or the local cache: follow it live.
useData.subscribe((s, prev) => {
  if (s.messages === prev.messages || !backgroundGeneration()) return;
  for (const [conversationId, list] of Object.entries(s.messages)) {
    if (list === prev.messages[conversationId] || useChat.getState().streaming[conversationId]) continue;
    const m = list[list.length - 1];
    if (m?.role === 'assistant' && (m.status === 'streaming' || m.versions?.some((v) => v.status === 'streaming'))) void attach(conversationId, m.id);
  }
});

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
  let messageId: string;
  let createdAt: number;
  let prior: MessageVersion[] = [];
  if (opts.regenerateId) {
    const idx = all.findIndex((m) => m.id === opts.regenerateId);
    if (idx < 0) return;
    const existing = all[idx];
    history = all.slice(0, idx);
    prior = existing.versions?.length ? [...existing.versions] : [];
    if (prior.length) prior[existing.versionIndex ?? prior.length - 1] = snapshot(existing);
    else prior.push(snapshot(existing));
    messageId = existing.id;
    createdAt = existing.createdAt;
  } else {
    history = all;
    messageId = uid();
    createdAt = nextTimestamp(conversationId);
  }
  const turns = buildContext(conv, history);
  const job: JobSnapshot = {
    conversationId,
    messageId,
    createdAt,
    prior,
    live: targets.map((x) => ({ content: '', model: x.model, providerId: x.provider.id, providerName: x.provider.name, status: 'streaming' })),
  };
  const withTitle = !opts.regenerateId;
  // Direct-mode providers are reached from the browser, so only the page can stream them.
  if (backgroundGeneration() && targets.every((x) => x.provider.mode !== 'direct')) await generateOnServer(conv, job, targets, turns, withTitle);
  else await generateHere(conv, job, targets, turns, withTitle);
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
  // The reply being generated (if any) comes after this message and is deleted below.
  const stopped = stopGeneration(m.conversationId, { discard: true });
  const all = getMessages(m.conversationId);
  const idx = all.findIndex((x) => x.id === m.id);
  saveMessage({ ...m, content });
  deleteMessages(
    m.conversationId,
    all.slice(idx + 1).map((x) => x.id),
  );
  // Wait for a stopped stream to settle before starting a new one.
  await stopped;
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
  if (useChat.getState().streaming[m.conversationId]?.messageId === m.id) void stopGeneration(m.conversationId, { discard: true });
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
    projectId: conv.projectId,
    titleGenerated: true,
  });
  for (const x of upto) saveMessage({ ...x, id: uid(), conversationId: fork.id, syncedAt: undefined });
  openConversation(fork.id);
}

export function clearConversation(conversationId: string) {
  void stopGeneration(conversationId, { discard: true });
  deleteMessages(
    conversationId,
    getMessages(conversationId).map((m) => m.id),
  );
}

export async function autoTitle(conversationId: string, force = false) {
  const { settings, conversations } = useData.getState();
  const conv = conversations[conversationId];
  if (!conv || (!force && (!settings.autoTitle || conv.titleGenerated))) return;
  const msgs = getMessages(conversationId);
  const user = msgs.find((m) => m.role === 'user');
  const reply = msgs.find((m) => m.role === 'assistant' && m.content);
  if (!user || !reply) return;
  const target = titleTarget(conv);
  if (!target) return;
  const prompt = titlePrompt(user.content || user.attachments?.map((a) => a.name).join(', ') || '', reply.content);
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
