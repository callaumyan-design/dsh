// Converts exported data (OmniChat backups, single-conversation JSON, ChatGPT exports) into sync operations.
import type { PushOp } from '../../shared/types';
import { uid } from './utils';

export interface ImportPlan {
  format: 'omnichat' | 'conversation' | 'chatgpt';
  conversations: number;
  messages: number;
  ops: PushOp[];
}

type AnyObj = Record<string, any>;

function fromOmniChat(j: AnyObj): ImportPlan {
  const ops: PushOp[] = [];
  const keys: Record<string, string> = j.keys ?? {};
  let conversations = 0;
  for (const e of j.entities ?? []) {
    if (!e?.kind || !e?.id) continue;
    const data = { ...(e.data ?? {}) };
    if (e.kind === 'provider') {
      delete data.hasKey;
      delete data.keyHint;
      if (keys[e.id]) data.apiKey = keys[e.id];
    }
    if (e.kind === 'conversation') conversations++;
    ops.push({ kind: e.kind, id: e.id, data });
  }
  const msgs = (j.messages ?? []).filter((m: AnyObj) => m?.id && m?.conversationId);
  for (const m of msgs) ops.push({ kind: 'message', id: m.id, data: { ...m.data, id: m.id, conversationId: m.conversationId } });
  return { format: 'omnichat', conversations, messages: msgs.length, ops };
}

function fromConversation(j: AnyObj): ImportPlan {
  const convId = uid();
  const c = j.conversation;
  const ops: PushOp[] = [{ kind: 'conversation', id: convId, data: { ...c, id: convId } }];
  for (const m of j.messages ?? []) {
    const id = uid();
    ops.push({ kind: 'message', id, data: { ...m, id, conversationId: convId } });
  }
  return { format: 'conversation', conversations: 1, messages: ops.length - 1, ops };
}

function fromChatGPT(list: AnyObj[]): ImportPlan {
  const ops: PushOp[] = [];
  let messages = 0;
  for (const conv of list) {
    const mapping: AnyObj = conv.mapping ?? {};
    let node: AnyObj | undefined = mapping[conv.current_node];
    const chain: AnyObj[] = [];
    while (node) {
      chain.push(node);
      node = node.parent ? mapping[node.parent] : undefined;
    }
    chain.reverse();
    const convId = uid();
    const created = Math.round((conv.create_time ?? Date.now() / 1000) * 1000);
    let last = created;
    const msgOps: PushOp[] = [];
    for (const n of chain) {
      const m = n.message;
      const role = m?.author?.role;
      if (role !== 'user' && role !== 'assistant') continue;
      if (m.metadata?.is_visually_hidden_from_conversation) continue;
      const ct = m.content?.content_type;
      if (ct !== 'text' && ct !== 'multimodal_text') continue;
      const text = (m.content.parts ?? [])
        .filter((p: unknown) => typeof p === 'string')
        .join('\n')
        .trim();
      if (!text) continue;
      const createdAt = Math.max(last + 1, Math.round((m.create_time ?? 0) * 1000));
      last = createdAt;
      const id = uid();
      msgOps.push({
        kind: 'message',
        id,
        data: {
          id,
          conversationId: convId,
          role,
          content: text,
          createdAt,
          status: role === 'assistant' ? 'done' : undefined,
          model: role === 'assistant' ? (m.metadata?.model_slug ?? 'chatgpt') : undefined,
          providerName: role === 'assistant' ? 'ChatGPT' : undefined,
        },
      });
    }
    if (!msgOps.length) continue;
    ops.push({
      kind: 'conversation',
      id: convId,
      data: { id: convId, title: conv.title || 'ChatGPT', createdAt: created, lastMessageAt: last, titleGenerated: true },
    });
    ops.push(...msgOps);
    messages += msgOps.length;
  }
  return { format: 'chatgpt', conversations: ops.filter((o) => o.kind === 'conversation').length, messages, ops };
}

export function planImport(json: unknown): ImportPlan {
  if (Array.isArray(json)) {
    if (json.length && json[0]?.mapping) return fromChatGPT(json);
    throw new Error('Unrecognized file format');
  }
  const j = json as AnyObj;
  if (j?.app === 'omnichat' || (Array.isArray(j?.entities) && Array.isArray(j?.messages))) return fromOmniChat(j);
  if (j?.conversation && Array.isArray(j?.messages)) return fromConversation(j);
  throw new Error('Unrecognized file format');
}

/** Splits operations into request-sized chunks. */
export function chunkOps(ops: PushOp[], maxOps = 150, maxBytes = 3_000_000): PushOp[][] {
  const chunks: PushOp[][] = [];
  let cur: PushOp[] = [];
  let size = 0;
  for (const op of ops) {
    const len = JSON.stringify(op).length;
    if (cur.length && (cur.length >= maxOps || size + len > maxBytes)) {
      chunks.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(op);
    size += len;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}
