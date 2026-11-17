import { useEffect, useState, useSyncExternalStore } from 'react';
import { todayISO } from '../lib/date';
import type { ThemePref } from '../lib/types';

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', cb);
      return () => mql.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export const useIsMobile = () => useMediaQuery('(max-width: 719px)');

/** 当前日期，跨过午夜时自动刷新 */
export function useToday(): string {
  const [today, setToday] = useState(todayISO);
  useEffect(() => {
    const id = setInterval(() => {
      const t = todayISO();
      setToday((prev) => (prev === t ? prev : t));
    }, 30_000);
    const onVis = () => document.visibilityState === 'visible' && setToday(todayISO());
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  return today;
}

export function useApplyTheme(theme: ThemePref) {
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    meta?.setAttribute('content', dark ? '#0f1218' : '#eef0f4');
  }, [theme]);
}

export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function useInstallPrompt() {
  const [evt, setEvt] = useState<(Event & { prompt: () => Promise<void> }) | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      e.preventDefault();
      setEvt(e as Event & { prompt: () => Promise<void> });
    };
    window.addEventListener('beforeinstallprompt', on);
    return () => window.removeEventListener('beforeinstallprompt', on);
  }, []);
  return evt
    ? async () => {
        await evt.prompt();
        setEvt(null);
      }
    : null;
}
