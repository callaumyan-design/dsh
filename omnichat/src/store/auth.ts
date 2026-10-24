import { create } from 'zustand';
import { api, ApiError, getToken, onUnauthorized, setToken } from '@/lib/api';
import { resetSync } from '@/lib/sync';
import { forgetProviderKey } from '@/lib/ai';
import { hydrate, resetData } from './data';
import type { AuthStatus, PublicUser } from '../../shared/types';

type Phase = 'loading' | 'anonymous' | 'authed';

interface AuthState {
  phase: Phase;
  status?: AuthStatus;
  user?: PublicUser;
  offline?: boolean;
}

export const useAuth = create<AuthState>(() => ({ phase: 'loading' }));

const USER_KEY = 'omnichat.user';

function cacheUser(u: PublicUser | null) {
  try {
    if (u) localStorage.setItem(USER_KEY, JSON.stringify(u));
    else localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
}

function cachedUser(): PublicUser | null {
  try {
    const s = localStorage.getItem(USER_KEY);
    return s ? (JSON.parse(s) as PublicUser) : null;
  } catch {
    return null;
  }
}

async function enter(user: PublicUser, offline = false) {
  cacheUser(user);
  useAuth.setState({ phase: 'authed', user, offline });
  await hydrate(user.id);
}

export async function initAuth() {
  onUnauthorized(() => void signOutLocal());
  if (getToken()) {
    try {
      const { user } = await api<{ user: PublicUser }>('/api/auth/me');
      await enter(user);
      return;
    } catch (err) {
      const cached = cachedUser();
      if (err instanceof ApiError && err.status === 0 && cached) {
        await enter(cached, true);
        return;
      }
      if (!(err instanceof ApiError) || err.status === 401) setToken(null);
    }
  }
  await loadStatus();
  useAuth.setState({ phase: 'anonymous' });
}

export async function loadStatus() {
  try {
    const status = await api<AuthStatus>('/api/auth/status');
    useAuth.setState({ status });
  } catch {
    /* server unreachable */
  }
}

export async function login(username: string, password: string) {
  const r = await api<{ token: string; user: PublicUser }>('/api/auth/login', { body: { username, password } });
  setToken(r.token);
  await enter(r.user);
}

export async function register(username: string, password: string) {
  const r = await api<{ token: string; user: PublicUser }>('/api/auth/register', { body: { username, password } });
  setToken(r.token);
  await enter(r.user);
}

async function signOutLocal() {
  setToken(null);
  cacheUser(null);
  forgetProviderKey();
  await resetSync();
  resetData();
  useAuth.setState({ phase: 'anonymous', user: undefined });
  await loadStatus();
}

export async function logout() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch {
    /* ignore */
  }
  await signOutLocal();
}
