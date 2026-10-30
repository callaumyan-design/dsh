// Conversation titles, generated after the first reply (in the browser, or on the server for background replies).
import { truncate } from '../utils';

export function titlePrompt(user: string, reply: string): string {
  return (
    `Write a short title for the conversation below, in the same language the user wrote in ` +
    `(at most 12 Chinese characters or 6 English words). Reply with the title only — no quotes, no punctuation at the end.\n\n` +
    `User: ${truncate(user, 800)}\n\nAssistant: ${truncate(reply, 800)}`
  );
}

export function cleanTitle(s: string): string {
  return s
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/^\s*(title|标题)\s*[:：]\s*/i, '')
    .replace(/[\s"'“”‘’《》「」*#`]+/g, (m) => (/\s/.test(m) ? ' ' : ''))
    .replace(/[。.!！?？,，;；:：]+$/, '')
    .trim()
    .slice(0, 50);
}
