import { create } from 'zustand';
import type { QuadrantId, View } from '../lib/types';

export interface Toast {
  id: number;
  text: string;
  tone?: 'default' | 'success' | 'error';
  action?: { label: string; run: () => void };
}

export interface ConfirmRequest {
  title: string;
  body?: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
}

export type DialogName = 'settings' | 'shortcuts' | 'add' | null;

interface UIState {
  view: View;
  search: string;
  tagFilter: string | null;
  openTaskId: string | null;
  focused: QuadrantId | null;
  dialog: DialogName;
  addDefaults: { quadrant?: QuadrantId; due?: string } | null;
  confirm: ConfirmRequest | null;
  toasts: Toast[];
  /** 刚完成的任务，用于播放完成动画 */
  justCompleted: string | null;

  setView: (v: View) => void;
  setSearch: (s: string) => void;
  setTagFilter: (t: string | null) => void;
  openTask: (id: string | null) => void;
  setFocused: (q: QuadrantId | null) => void;
  openDialog: (d: DialogName, addDefaults?: UIState['addDefaults']) => void;
  askConfirm: (c: ConfirmRequest | null) => void;
  toast: (t: Omit<Toast, 'id'>, ms?: number) => void;
  dismissToast: (id: number) => void;
  markCompleted: (id: string | null) => void;
}

let toastSeq = 1;

const VIEWS: View[] = ['matrix', 'agenda', 'stats'];

export function viewFromHash(): View {
  if (typeof location === 'undefined') return 'matrix';
  const h = location.hash.replace('#', '') as View;
  return VIEWS.includes(h) ? h : 'matrix';
}

export const useUI = create<UIState>()((set, get) => ({
  view: viewFromHash(),
  search: '',
  tagFilter: null,
  openTaskId: null,
  focused: null,
  dialog: null,
  addDefaults: null,
  confirm: null,
  toasts: [],
  justCompleted: null,

  setView: (view) => {
    set({ view });
    try {
      if (location.hash.replace('#', '') !== view) history.replaceState(null, '', `#${view}`);
    } catch {
      /* 某些嵌入环境不允许修改地址 */
    }
  },
  setSearch: (search) => set({ search }),
  setTagFilter: (tagFilter) => set({ tagFilter }),
  openTask: (openTaskId) => set({ openTaskId }),
  setFocused: (focused) => set({ focused }),
  openDialog: (dialog, addDefaults = null) => set({ dialog, addDefaults }),
  askConfirm: (confirm) => set({ confirm }),
  toast: (t, ms = 5000) => {
    const id = toastSeq++;
    set({ toasts: [...get().toasts.slice(-2), { ...t, id }] });
    setTimeout(() => get().dismissToast(id), ms);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  markCompleted: (justCompleted) => set({ justCompleted }),
}));
