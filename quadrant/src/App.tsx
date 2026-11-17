import { useEffect } from 'react';
import { redo, undo } from './actions';
import { AddDialog } from './components/AddDialog';
import { AgendaView } from './components/AgendaView';
import { BottomNav, FilterBar, IntroBanner, Topbar } from './components/Chrome';
import { ConfirmDialog, SettingsDialog, ShortcutsDialog, Toasts } from './components/Dialogs';
import { Matrix } from './components/Matrix';
import { StatsView } from './components/StatsView';
import { TaskDrawer } from './components/TaskDrawer';
import { isTypingTarget, useApplyTheme, useIsMobile, useToday } from './hooks';
import { QUADRANT_IDS } from './lib/quadrants';
import { useStore } from './store/useStore';
import { useUI, viewFromHash } from './store/useUI';

function useGlobalHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUI.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z' && !isTypingTarget(e.target)) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y' && !isTypingTarget(e.target)) {
        e.preventDefault();
        redo();
        return;
      }
      if (mod || e.altKey || isTypingTarget(e.target)) return;
      const modalOpen = !!ui.dialog || !!ui.confirm || !!document.querySelector('.modal-layer');
      if (e.key === 'Escape') {
        if (ui.openTaskId || modalOpen) return;
        if (ui.focused) ui.setFocused(null);
        else if (ui.tagFilter) ui.setTagFilter(null);
        return;
      }
      if (modalOpen || ui.openTaskId) return;
      // 卡片上的按键由卡片自己处理
      const onCard = (e.target as HTMLElement)?.closest?.('.card, .agenda-row');
      switch (e.key) {
        case 'n':
        case 'N':
          e.preventDefault();
          ui.openDialog('add', ui.focused ? { quadrant: ui.focused } : null);
          break;
        case '/':
          e.preventDefault();
          document.getElementById('global-search')?.focus();
          if (!document.getElementById('global-search')) document.querySelector<HTMLButtonElement>('button[aria-label="搜索"]')?.click();
          break;
        case '?':
          ui.openDialog('shortcuts');
          break;
        case 'm':
        case 'M':
          ui.setView('matrix');
          break;
        case 'a':
        case 'A':
          ui.setView('agenda');
          break;
        case 's':
        case 'S':
          ui.setView('stats');
          break;
        case 'f':
        case 'F': {
          if (ui.view !== 'matrix') break;
          if (ui.focused) ui.setFocused(null);
          else {
            const q = (document.activeElement as HTMLElement)?.closest?.('[data-quadrant]')?.getAttribute('data-quadrant');
            ui.setFocused(QUADRANT_IDS.find((x) => x === q) ?? 'q1');
          }
          break;
        }
        default:
          if (!onCard && ['1', '2', '3', '4'].includes(e.key) && ui.view === 'matrix') {
            // 不在卡片上时，数字键聚焦到对应象限的第一张卡片
            const first = document.querySelector<HTMLElement>(`[data-quadrant="q${e.key}"] .card[tabindex]`);
            first?.focus();
          }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export default function App() {
  const theme = useStore((s) => s.prefs.theme);
  const view = useUI((s) => s.view);
  const today = useToday();
  const mobile = useIsMobile();
  useApplyTheme(theme);
  useGlobalHotkeys();

  useEffect(() => {
    const onHash = () => useUI.getState().setView(viewFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (view !== 'matrix') useUI.getState().setFocused(null);
  }, [view]);

  return (
    <div className={`app view-${view}${mobile ? ' is-mobile' : ''}`}>
      <Topbar mobile={mobile} />
      <main className="main" id="main">
        {view !== 'stats' && <IntroBanner />}
        {view !== 'stats' && <FilterBar today={today} showCompletedToggle={view === 'matrix' && !mobile} />}
        {view === 'matrix' && <Matrix today={today} />}
        {view === 'agenda' && <AgendaView today={today} />}
        {view === 'stats' && <StatsView today={today} />}
      </main>
      {mobile && <BottomNav />}
      <TaskDrawer today={today} />
      <AddDialog />
      <SettingsDialog />
      <ShortcutsDialog />
      <ConfirmDialog />
      <Toasts />
    </div>
  );
}
