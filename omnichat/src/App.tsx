import { useEffect } from 'react';
import { AuthPage } from '@/components/AuthPage';
import { ChatView } from '@/components/chat/ChatView';
import { Sidebar } from '@/components/layout/Sidebar';
import { Logo } from '@/components/layout/Logo';
import { SettingsModal } from '@/components/settings/SettingsModal';
import { Dialogs, Toasts } from '@/components/ui/overlays';
import { hasOpenOverlay } from '@/components/ui/primitives';
import { applyTheme, cachedTheme } from '@/lib/theme';
import { initAuth, useAuth } from '@/store/auth';
import { useData } from '@/store/data';
import { stopGeneration, useChat } from '@/store/chat';
import { openConversation, openSettings, toast, useUI } from '@/store/ui';
import { useLang, useT } from '@/i18n';

function useThemeSync() {
  const hydrated = useData((s) => s.hydrated);
  const settings = useData((s) => s.settings);
  // Before sign-in, keep the look this device last used.
  const { theme, accent, fontSize } = hydrated ? settings : cachedTheme();
  const lang = useLang();
  useEffect(() => {
    const apply = () => applyTheme(theme, accent, fontSize);
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme, accent, fontSize]);
  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  }, [lang]);
}

function useShortcuts() {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      // Escape stops generation when no overlay is open.
      if (e.key === 'Escape' && !e.defaultPrevented && !hasOpenOverlay()) {
        const id = useUI.getState().activeId;
        if (id && useChat.getState().streaming[id]) {
          e.preventDefault();
          stopGeneration(id);
        }
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (e.shiftKey && k === 'o') {
        e.preventDefault();
        openConversation(null);
      } else if (!e.shiftKey && k === 'k') {
        e.preventDefault();
        window.dispatchEvent(new Event('omnichat:search'));
      } else if (k === ',') {
        e.preventDefault();
        openSettings();
      } else if (e.shiftKey && k === 's') {
        e.preventDefault();
        useUI.setState((s) => ({ sidebarOpen: !s.sidebarOpen }));
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
}

function useSyncNotices() {
  const t = useT();
  useEffect(() => {
    const h = (e: Event) => toast(`${t('sync.rejected')}: ${(e as CustomEvent).detail?.error ?? ''}`, 'error', 6000);
    window.addEventListener('omnichat:sync-rejected', h);
    return () => window.removeEventListener('omnichat:sync-rejected', h);
  }, [t]);
}

function useLeaveGuard() {
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (Object.keys(useChat.getState().streaming).length) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);
}

function Shell() {
  useShortcuts();
  useSyncNotices();
  useLeaveGuard();
  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar />
      <ChatView />
      <SettingsModal />
    </div>
  );
}

export default function App() {
  const phase = useAuth((s) => s.phase);
  useThemeSync();
  useEffect(() => {
    void initAuth();
  }, []);

  return (
    <>
      {phase === 'loading' && (
        <div className="flex h-full items-center justify-center">
          <Logo className="size-12 animate-pulse" />
        </div>
      )}
      {phase === 'anonymous' && <AuthPage />}
      {phase === 'authed' && <Shell />}
      <Toasts />
      <Dialogs />
    </>
  );
}
