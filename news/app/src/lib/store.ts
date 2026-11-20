// 本机状态（存在 localStorage）。登录后与服务器同步，没登录也能正常用。
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Bookmark, Story, User } from './types';

interface State {
  token: string | null;
  user: User | null;
  bookmarks: Bookmark[];
  read: string[];
  /** 只看这些分类；null = 全部 */
  categories: string[] | null;
  /** 登录状态下还没同步到服务器的改动 */
  pending: { put: string[]; del: string[]; read: string[]; prefs: boolean };

  setSession(token: string, user: User): void;
  clearSession(): void;
  toggleBookmark(story: Story, date: string | null): boolean;
  removeBookmark(id: string): void;
  markRead(id: string): void;
  setCategories(c: string[] | null): void;
}

const READ_LIMIT = 2000;
const emptyPending = () => ({ put: [], del: [], read: [], prefs: false });

export const toBookmark = (s: Story, date: string | null): Bookmark => ({
  id: s.id,
  title: s.title,
  url: s.sources[0]?.url ?? '',
  summary: s.summary,
  date,
  category: s.category,
  source: s.sources.map((x) => x.name).join('、'),
  savedAt: new Date().toISOString(),
});

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      bookmarks: [],
      read: [],
      categories: null,
      pending: emptyPending(),

      setSession: (token, user) => set({ token, user }),
      clearSession: () => set({ token: null, user: null, pending: emptyPending() }),

      toggleBookmark(story, date) {
        const { bookmarks, pending, token } = get();
        const exists = bookmarks.some((b) => b.id === story.id);
        if (exists) {
          set({
            bookmarks: bookmarks.filter((b) => b.id !== story.id),
            pending: token ? { ...pending, put: pending.put.filter((i) => i !== story.id), del: [...new Set([...pending.del, story.id])] } : pending,
          });
          return false;
        }
        set({
          bookmarks: [toBookmark(story, date), ...bookmarks],
          pending: token ? { ...pending, del: pending.del.filter((i) => i !== story.id), put: [...new Set([...pending.put, story.id])] } : pending,
        });
        return true;
      },
      removeBookmark(id) {
        const { bookmarks, pending, token } = get();
        set({
          bookmarks: bookmarks.filter((b) => b.id !== id),
          pending: token ? { ...pending, put: pending.put.filter((i) => i !== id), del: [...new Set([...pending.del, id])] } : pending,
        });
      },
      markRead(id) {
        const { read, pending, token } = get();
        if (read.includes(id)) return;
        set({ read: [...read, id].slice(-READ_LIMIT), pending: token ? { ...pending, read: [...pending.read, id] } : pending });
      },
      setCategories(categories) {
        const { pending, token } = get();
        set({ categories, pending: token ? { ...pending, prefs: true } : pending });
      },
    }),
    { name: 'tech-morning', version: 1 },
  ),
);
