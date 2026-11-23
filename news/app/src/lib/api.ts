import type { Bookmark, Edition, EditionIndexEntry, User } from './types';

export const API_BASE: string = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, { method = 'GET', body, token }: { method?: string; body?: unknown; token?: string | null } = {}): Promise<T> {
  if (!API_BASE) throw new ApiError(0, '还没有配置服务器地址');
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, '连不上服务器，请检查网络');
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `服务器返回 ${res.status}`);
  return data as T;
}

export const api = {
  latest: () => request<Edition>('/editions/latest'),
  edition: (date: string) => request<Edition>(`/editions/${date}`),
  editions: () => request<EditionIndexEntry[]>('/editions'),

  registerOptions: (name: string, token: string | null) => request<{ challengeId: string; options: any }>('/auth/register/options', { method: 'POST', body: { name }, token }),
  registerVerify: (challengeId: string, response: unknown, token: string | null) =>
    request<{ token: string; user: User }>('/auth/register/verify', { method: 'POST', body: { challengeId, response }, token }),
  loginOptions: () => request<{ challengeId: string; options: any }>('/auth/login/options', { method: 'POST', body: {} }),
  loginVerify: (challengeId: string, response: unknown) => request<{ token: string; user: User }>('/auth/login/verify', { method: 'POST', body: { challengeId, response } }),
  logout: (token: string) => request('/auth/logout', { method: 'POST', body: {}, token }),

  me: (token: string) => request<{ user: User; prefs: { categories?: string[] }; read: string[]; passkeys: number }>('/me', { token }),
  putPrefs: (token: string, prefs: { categories?: string[] }) => request('/me/prefs', { method: 'PUT', body: prefs, token }),
  markRead: (token: string, ids: string[]) => request('/me/read', { method: 'POST', body: { ids }, token }),
  bookmarks: (token: string) => request<Bookmark[]>('/me/bookmarks', { token }),
  putBookmark: (token: string, b: Bookmark) => request<Bookmark>(`/me/bookmarks/${encodeURIComponent(b.id)}`, { method: 'PUT', body: b, token }),
  deleteBookmark: (token: string, id: string) => request(`/me/bookmarks/${encodeURIComponent(id)}`, { method: 'DELETE', token }),

  pushKey: () => request<{ key: string }>('/push/key'),
  pushSubscribe: (subscription: PushSubscriptionJSON, token: string | null) => request('/push/subscribe', { method: 'POST', body: { subscription }, token }),
  pushUnsubscribe: (endpoint: string) => request('/push/unsubscribe', { method: 'POST', body: { endpoint } }),
};
