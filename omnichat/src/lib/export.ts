import type { Conversation, Message } from './types';
import { downloadFile } from './utils';

function safeName(s: string) {
  return s.replace(/[\\/:*?"<>|\n\r]+/g, ' ').trim().slice(0, 60) || 'conversation';
}

export function conversationToMarkdown(conv: Conversation, messages: Message[], labels: { user: string; assistant: string; system: string }) {
  const lines: string[] = [`# ${conv.title}`, ''];
  lines.push(`> ${new Date(conv.createdAt).toLocaleString()}${conv.model ? ` · ${conv.model}` : ''}`, '');
  if (conv.systemPrompt?.trim()) lines.push(`## ${labels.system}`, '', conv.systemPrompt.trim(), '');
  for (const m of messages) {
    const who = m.role === 'user' ? labels.user : `${labels.assistant}${m.model ? ` (${m.model})` : ''}`;
    lines.push(`## ${who}`, '');
    for (const a of m.attachments ?? []) lines.push(`*[${a.kind}: ${a.name}]*`, '');
    if (m.reasoning) lines.push('<details><summary>Reasoning</summary>', '', m.reasoning.trim(), '', '</details>', '');
    lines.push(m.content.trim() || (m.error ? `*Error: ${m.error}*` : ''), '');
  }
  return lines.join('\n');
}

export function exportConversationMarkdown(conv: Conversation, messages: Message[], labels: { user: string; assistant: string; system: string }) {
  downloadFile(`${safeName(conv.title)}.md`, conversationToMarkdown(conv, messages, labels), 'text/markdown;charset=utf-8');
}

export function exportConversationJson(conv: Conversation, messages: Message[]) {
  const { syncedAt: _a, ...c } = conv;
  downloadFile(
    `${safeName(conv.title)}.json`,
    JSON.stringify({ conversation: c, messages: messages.map(({ syncedAt: _b, ...m }) => m) }, null, 2),
  );
}
