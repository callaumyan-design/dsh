// 与服务器同步：先把本机的改动推上去，再拉回服务器上的完整数据。
import { api, ApiError } from './api';
import { useStore } from './store';
import type { Bookmark } from './types';

let running: Promise<void> | null = null;

export function sync(): Promise<void> {
  running ??= doSync().finally(() => (running = null));
  return running;
}

/** 刚登录：把登录前在本机收藏、读过的内容都并进账号。 */
export function adoptLocalData() {
  const s = useStore.getState();
  useStore.setState({
    pending: {
      put: s.bookmarks.map((b) => b.id),
      del: [],
      read: s.read.slice(-500),
      prefs: s.categories !== null,
    },
  });
}

async function doSync() {
  const { token } = useStore.getState();
  if (!token) return;
  try {
    const p = useStore.getState().pending;
    const local = new Map(useStore.getState().bookmarks.map((b) => [b.id, b]));
    await Promise.all([
      ...p.put.map((id) => (local.has(id) ? api.putBookmark(token, local.get(id)!) : null)),
      ...p.del.map((id) => api.deleteBookmark(token, id)),
      p.read.length ? api.markRead(token, p.read) : null,
      p.prefs ? api.putPrefs(token, { categories: useStore.getState().categories ?? [] }) : null,
    ]);
    // 推送成功：清掉已处理的部分（同步期间新产生的改动保留）
    useStore.setState((s) => ({
      pending: {
        put: s.pending.put.filter((i) => !p.put.includes(i)),
        del: s.pending.del.filter((i) => !p.del.includes(i)),
        read: s.pending.read.filter((i) => !p.read.includes(i)),
        prefs: s.pending.prefs && !p.prefs,
      },
    }));

    const [me, bookmarks] = await Promise.all([api.me(token), api.bookmarks(token)]);
    useStore.setState((s) => {
      // 同步期间本机新增、尚未推送的收藏也保留
      const keep = s.bookmarks.filter((b) => s.pending.put.includes(b.id));
      const merged: Bookmark[] = [...keep, ...bookmarks.filter((b) => !s.pending.del.includes(b.id) && !keep.some((k) => k.id === b.id))];
      return {
        user: me.user,
        bookmarks: merged,
        read: [...new Set([...s.read, ...me.read])].slice(-2000),
        categories: s.pending.prefs ? s.categories : me.prefs.categories?.length ? me.prefs.categories : null,
        // 服务器上的设置是完整的关注列表（含栏目），空列表表示全部关注
      };
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) useStore.getState().clearSession(); // 会话过期
    else throw err;
  }
}
