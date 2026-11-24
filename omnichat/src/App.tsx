import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { AuthPage } from '@/components/AuthPage';
import { ChatView } from '@/components/chat/ChatView';
import { Sidebar } from '@/components/layout/Sidebar';
import { Logo } from '@/components/layout/Logo';
import { SettingsModal } from '@/components/settings/SettingsModal';
import { Dialogs, Toasts } from '@/components/ui/overlays';
import { ProjectDialogs } from '@/components/project/ProjectDialogs';
import { hasOpenOverlay } from '@/components/ui/primitives';
import { applyTheme, cachedTheme } from '@/lib/theme';
import { initAuth, useAuth } from '@/store/auth';
import { useData } from '@/store/data';
import { useComposer } from '@/store/composer';
import { onUpdateAvailable } from '@/lib/version';
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
      // Replies generated on the server keep going when the page closes; only warn about ones streamed here.
      if (Object.values(useChat.getState().streaming).some((x) => !x.remote)) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);
}

/**
 * Pages stay open for days (phones resume them rather than reloading), so after an update they would keep running
 * old code that can't show what the new server sends. Reload as soon as a newer build is reported, unless that
 * would lose something: an unsent draft, an open dialog, or a reply this page is streaming itself. Then offer it.
 */
function UpdateNotice() {
  const t = useT();
  const [ready, setReady] = useState(false);
  useEffect(() => onUpdateAvailable(() => setReady(true)), []);
  useEffect(() => {
    if (!ready) return;
    const tryReload = () => {
      const { drafts, busy } = useComposer.getState();
      const unsent = busy || Object.values(drafts).some((d) => d.text.trim() || d.attachments.length);
      const streamingHere = Object.values(useChat.getState().streaming).some((x) => !x.remote);
      if (!unsent && !streamingHere && !hasOpenOverlay()) window.location.reload();
    };
    tryReload();
    // Otherwise try again whenever the page comes back to the foreground.
    const h = () => document.visibilityState === 'visible' && tryReload();
    document.addEventListener('visibilitychange', h);
    return () => document.removeEventListener('visibilitychange', h);
  }, [ready]);
  if (!ready) return null;
  return (
    <div className="safe-top pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center pt-2">
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-line bg-elevated px-3.5 py-1.5 text-sm text-fg shadow-pop hover:bg-muted"
      >
        <RefreshCw className="size-3.5 text-accent" />
        {t('update.ready')}
        <span className="font-medium text-accent">{t('update.reload')}</span>
      </button>
    </div>
  );
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
      <ProjectDialogs />
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
      <UpdateNotice />
    </>
  );
}
