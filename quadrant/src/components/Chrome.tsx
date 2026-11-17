import { ChartColumn, CalendarDays, CircleHelp, Keyboard, LayoutGrid, Plus, Redo2, Search, Settings, Undo2, X } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { redo, undo } from '../actions';
import { formatDateLong } from '../lib/date';
import type { View } from '../lib/types';
import { useStore } from '../store/useStore';
import { useUI } from '../store/useUI';
import { Switch } from './ui';

const VIEWS: { id: View; label: string; icon: ReactNode }[] = [
  { id: 'matrix', label: '矩阵', icon: <LayoutGrid aria-hidden /> },
  { id: 'agenda', label: '日程', icon: <CalendarDays aria-hidden /> },
  { id: 'stats', label: '统计', icon: <ChartColumn aria-hidden /> },
];

export function LogoMark() {
  return (
    <svg className="logo-mark" viewBox="0 0 32 32" aria-hidden>
      <rect x="2" y="2" width="13" height="13" rx="3.5" className="lm q1" />
      <rect x="17" y="2" width="13" height="13" rx="3.5" className="lm q2" />
      <rect x="2" y="17" width="13" height="13" rx="3.5" className="lm q3" />
      <rect x="17" y="17" width="13" height="13" rx="3.5" className="lm q4" />
    </svg>
  );
}

export function SearchBox({ autoFocus, onClose }: { autoFocus?: boolean; onClose?: () => void }) {
  const search = useUI((s) => s.search);
  const setSearch = useUI((s) => s.setSearch);
  return (
    <div className="search">
      <Search aria-hidden />
      <input
        id="global-search"
        type="search"
        value={search}
        autoFocus={autoFocus}
        placeholder="搜索任务、标签、备注"
        aria-label="搜索任务"
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setSearch('');
            (e.target as HTMLInputElement).blur();
            onClose?.();
          }
        }}
      />
      {!search && <kbd className="search-kbd">/</kbd>}
    </div>
  );
}

export function Topbar({ mobile }: { mobile: boolean }) {
  const view = useUI((s) => s.view);
  const setView = useUI((s) => s.setView);
  const openDialog = useUI((s) => s.openDialog);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const search = useUI((s) => s.search);
  const [searchOpen, setSearchOpen] = useState(false);

  if (mobile) {
    return (
      <header className="topbar is-mobile">
        {searchOpen || search ? (
          <>
            <SearchBox autoFocus onClose={() => setSearchOpen(false)} />
            <button
              type="button"
              className="icon-btn"
              aria-label="关闭搜索"
              onClick={() => {
                useUI.getState().setSearch('');
                setSearchOpen(false);
              }}
            >
              <X />
            </button>
          </>
        ) : (
          <>
            <div className="brand">
              <LogoMark />
              <span className="brand-name">四象限</span>
            </div>
            <span className="spacer" />
            <button type="button" className="icon-btn" aria-label="撤销" disabled={!canUndo} onClick={undo}>
              <Undo2 />
            </button>
            <button type="button" className="icon-btn" aria-label="搜索" onClick={() => setSearchOpen(true)}>
              <Search />
            </button>
            <button type="button" className="icon-btn" aria-label="设置" onClick={() => openDialog('settings')}>
              <Settings />
            </button>
          </>
        )}
      </header>
    );
  }

  return (
    <header className="topbar">
      <div className="brand">
        <LogoMark />
        <span className="brand-name">四象限</span>
        <span className="brand-sub">任务计划</span>
      </div>
      <nav className="tabs" aria-label="视图">
        {VIEWS.map((v) => (
          <button key={v.id} type="button" className={`tab${view === v.id ? ' is-on' : ''}`} aria-current={view === v.id ? 'page' : undefined} onClick={() => setView(v.id)}>
            {v.icon}
            {v.label}
          </button>
        ))}
      </nav>
      <span className="spacer" />
      <SearchBox />
      <div className="tool-group">
        <button type="button" className="icon-btn" aria-label="撤销" title="撤销 (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
          <Undo2 />
        </button>
        <button type="button" className="icon-btn" aria-label="重做" title="重做 (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}>
          <Redo2 />
        </button>
        <button type="button" className="icon-btn" aria-label="使用帮助与快捷键" title="帮助与快捷键 (?)" onClick={() => openDialog('shortcuts')}>
          <Keyboard />
        </button>
        <button type="button" className="icon-btn" aria-label="设置" title="设置" onClick={() => openDialog('settings')}>
          <Settings />
        </button>
      </div>
      <button type="button" className="btn primary" onClick={() => openDialog('add')}>
        <Plus aria-hidden />
        新建任务
        <kbd>N</kbd>
      </button>
    </header>
  );
}

export function BottomNav() {
  const view = useUI((s) => s.view);
  const setView = useUI((s) => s.setView);
  const openDialog = useUI((s) => s.openDialog);
  const focused = useUI((s) => s.focused);
  return (
    <nav className="bottom-nav" aria-label="视图">
      {VIEWS.slice(0, 2).map((v) => (
        <button key={v.id} type="button" className={view === v.id ? 'is-on' : ''} aria-current={view === v.id ? 'page' : undefined} onClick={() => setView(v.id)}>
          {v.icon}
          <span>{v.label}</span>
        </button>
      ))}
      <button type="button" className="fab" aria-label="新建任务" onClick={() => openDialog('add', focused ? { quadrant: focused } : null)}>
        <Plus />
      </button>
      {VIEWS.slice(2).map((v) => (
        <button key={v.id} type="button" className={view === v.id ? 'is-on' : ''} aria-current={view === v.id ? 'page' : undefined} onClick={() => setView(v.id)}>
          {v.icon}
          <span>{v.label}</span>
        </button>
      ))}
      <button type="button" onClick={() => openDialog('shortcuts')} className="nav-help" aria-label="使用帮助">
        <CircleHelp aria-hidden />
        <span>帮助</span>
      </button>
    </nav>
  );
}

export function FilterBar({ today, showCompletedToggle }: { today: string; showCompletedToggle?: boolean }) {
  const tasks = useStore((s) => s.tasks);
  const showCompleted = useStore((s) => s.prefs.showCompleted);
  const setPrefs = useStore((s) => s.setPrefs);
  const tagFilter = useUI((s) => s.tagFilter);
  const setTagFilter = useUI((s) => s.setTagFilter);
  const search = useUI((s) => s.search);
  const setSearch = useUI((s) => s.setSearch);
  const scroller = useRef<HTMLDivElement>(null);

  const { tags, dueToday, overdue, open } = useMemo(() => {
    const count = new Map<string, number>();
    let dueToday = 0;
    let overdue = 0;
    let open = 0;
    for (const t of tasks) {
      if (t.done) continue;
      open++;
      for (const g of t.tags) count.set(g, (count.get(g) ?? 0) + 1);
      if (t.due === today) dueToday++;
      else if (t.due && t.due < today) overdue++;
    }
    return { tags: [...count.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g), dueToday, overdue, open };
  }, [tasks, today]);

  return (
    <div className="filterbar">
      <div className="today">
        <span className="today-date">{formatDateLong(today)}</span>
        <span className="today-stats">
          待办 <b>{open}</b>
          {dueToday > 0 && (
            <>
              {' · '}今天截止 <b>{dueToday}</b>
            </>
          )}
          {overdue > 0 && (
            <>
              {' · '}
              <span className="text-danger">
                逾期 <b>{overdue}</b>
              </span>
            </>
          )}
        </span>
      </div>
      <div className="tag-scroll" ref={scroller} role="group" aria-label="按标签筛选">
        {search && (
          <button type="button" className="chip is-on" onClick={() => setSearch('')}>
            搜索：{search}
            <X aria-hidden />
          </button>
        )}
        {tags.length > 0 && (
          <button type="button" className={`chip${!tagFilter ? ' is-on' : ''}`} onClick={() => setTagFilter(null)}>
            全部
          </button>
        )}
        {tags.map((g) => (
          <button key={g} type="button" className={`chip${tagFilter === g ? ' is-on' : ''}`} aria-pressed={tagFilter === g} onClick={() => setTagFilter(tagFilter === g ? null : g)}>
            #{g}
          </button>
        ))}
        {tagFilter && !tags.includes(tagFilter) && (
          <button type="button" className="chip is-on" onClick={() => setTagFilter(null)}>
            #{tagFilter}
            <X aria-hidden />
          </button>
        )}
      </div>
      {showCompletedToggle && (
        <label className="toggle-line" htmlFor="fb-done">
          <span>显示已完成</span>
          <Switch id="fb-done" label="显示已完成" checked={showCompleted} onChange={(v) => setPrefs({ showCompleted: v })} />
        </label>
      )}
    </div>
  );
}

export function IntroBanner() {
  const dismissed = useStore((s) => s.prefs.introDismissed);
  const setPrefs = useStore((s) => s.setPrefs);
  const hasSamples = useStore((s) => s.tasks.some((t) => t.sample));
  const removeSamples = useStore((s) => s.removeSamples);
  if (dismissed) return null;
  return (
    <div className="intro-wrap">
    <aside className="intro" aria-label="使用说明">
      <div className="intro-text">
        <strong>按“重要”和“紧急”两个维度给事情分类。</strong>
        <span>
          先做 <b className="t-q1">Q1</b>，多花时间在 <b className="t-q2">Q2</b>，把 <b className="t-q3">Q3</b> 交给别人，少碰 <b className="t-q4">Q4</b>。拖动卡片即可换象限，手机上长按后拖动。
          {hasSamples && ' 当前显示的是示例任务。'}
        </span>
      </div>
      <div className="intro-actions">
        {hasSamples && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              removeSamples();
              setPrefs({ introDismissed: true });
            }}
          >
            清空示例，开始使用
          </button>
        )}
        <button type="button" className="btn ghost" onClick={() => setPrefs({ introDismissed: true })}>
          知道了
        </button>
      </div>
    </aside>
    </div>
  );
}
