import { create } from 'zustand';
import type { ReasoningEffort } from '@/lib/types';

export type SettingsTab = 'providers' | 'models' | 'tools' | 'general' | 'prompts' | 'usage' | 'data' | 'account' | 'admin' | 'about';

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  message: string;
}

export interface ConfirmRequest {
  title: string;
  message?: string;
  confirmText?: string;
  danger?: boolean;
  resolve(ok: boolean): void;
}

export interface PromptRequest {
  title: string;
  value: string;
  placeholder?: string;
  resolve(value: string | null): void;
}

interface UIState {
  activeId: string | null;
  /** The project whose page is shown (only while no conversation is open). */
  projectId: string | null;
  /** Project create/edit dialog: 'new', a project id, or closed. */
  projectEditor: string | null;
  /** Conversation being moved to another project. */
  moveConversationId: string | null;
  sidebarOpen: boolean;
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  chatSettingsOpen: boolean;
  searchOpen: boolean;
  /** Model chosen on the welcome screen before a conversation exists. */
  draft: { providerId?: string; model?: string; promptId?: string; systemPrompt?: string; webSearch?: boolean; reasoningEffort?: ReasoningEffort };
  toasts: Toast[];
  confirm: ConfirmRequest | null;
  prompt: PromptRequest | null;
}

const isDesktop = () => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches;

function readHash(): { activeId: string | null; projectId: string | null } {
  const m = /^#\/([cp])\/([^/?#]+)/.exec(window.location.hash);
  const id = m ? decodeURIComponent(m[2]) : null;
  return { activeId: m?.[1] === 'c' ? id : null, projectId: m?.[1] === 'p' ? id : null };
}

export const useUI = create<UIState>(() => ({
  ...(typeof window !== 'undefined' ? readHash() : { activeId: null, projectId: null }),
  projectEditor: null,
  moveConversationId: null,
  sidebarOpen: isDesktop(),
  settingsOpen: false,
  settingsTab: 'providers',
  chatSettingsOpen: false,
  searchOpen: false,
  draft: {},
  toasts: [],
  confirm: null,
  prompt: null,
}));

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => useUI.setState(readHash()));
}

export function openConversation(id: string | null) {
  const hash = id ? `#/c/${encodeURIComponent(id)}` : '#/';
  if (window.location.hash !== hash) window.location.hash = hash;
  useUI.setState({ activeId: id, projectId: null, chatSettingsOpen: false });
  if (!isDesktop()) useUI.setState({ sidebarOpen: false });
}

/** Shows a project's page, where new chats start inside the project. */
export function openProject(id: string) {
  const hash = `#/p/${encodeURIComponent(id)}`;
  if (window.location.hash !== hash) window.location.hash = hash;
  useUI.setState({ activeId: null, projectId: id, chatSettingsOpen: false });
  if (!isDesktop()) useUI.setState({ sidebarOpen: false });
}

export function openSettings(tab?: SettingsTab) {
  useUI.setState((s) => ({ settingsOpen: true, settingsTab: tab ?? s.settingsTab }));
}

let toastId = 0;
export function toast(message: string, kind: Toast['kind'] = 'info', ms = 3200) {
  const id = ++toastId;
  useUI.setState((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, message }] }));
  setTimeout(() => useUI.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? ms + 2500 : ms);
}

export function confirmDialog(opts: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => useUI.setState({ confirm: { ...opts, resolve } }));
}

export function promptDialog(opts: Omit<PromptRequest, 'resolve'>): Promise<string | null> {
  return new Promise((resolve) => useUI.setState({ prompt: { ...opts, resolve } }));
}
