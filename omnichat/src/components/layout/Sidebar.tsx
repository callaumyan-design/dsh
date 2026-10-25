import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Cloud,
  CloudOff,
  LogOut,
  MessageSquareText,
  Monitor,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  Search,
  Settings,
  SquarePen,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { Dropdown, IconButton, MenuDivider, MenuItem } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { cn, isMac, startOfDay } from '@/lib/utils';
import type { Conversation, ThemeMode } from '@/lib/types';
import { logout, useDisplayName } from '@/store/auth';
import { useChat } from '@/store/chat';
import { removeConversation, updateConversation, updateSettings, useData } from '@/store/data';
import { confirmDialog, openConversation, openSettings, promptDialog, useUI } from '@/store/ui';
import { useLang, useT } from '@/i18n';
import { Logo } from './Logo';

interface Group {
  key: string;
  label: string;
  items: Conversation[];
}

function useGroups(conversations: Conversation[], lang: 'zh' | 'en', t: ReturnType<typeof useT>): Group[] {
  return useMemo(() => {
    const today = startOfDay(Date.now());
    const day = 86_400_000;
    const buckets = new Map<string, Group>();
    const add = (key: string, label: string, c: Conversation) => {
      if (!buckets.has(key)) buckets.set(key, { key, label, items: [] });
      buckets.get(key)!.items.push(c);
    };
    const monthFmt = new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'long' });
    const sorted = [...conversations].sort((a, b) => (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt));
    for (const c of sorted) {
      if (c.pinned) {
        add('pinned', t('sidebar.pinned'), c);
        continue;
      }
      const ts = c.lastMessageAt ?? c.createdAt;
      if (ts >= today) add('today', t('sidebar.today'), c);
      else if (ts >= today - day) add('yesterday', t('sidebar.yesterday'), c);
      else if (ts >= today - 7 * day) add('week', t('sidebar.week'), c);
      else if (ts >= today - 30 * day) add('month', t('sidebar.month'), c);
      else {
        const d = new Date(ts);
        add(`m-${d.getFullYear()}-${d.getMonth()}`, monthFmt.format(d), c);
      }
    }
    const order = ['pinned', 'today', 'yesterday', 'week', 'month'];
    return [...buckets.values()].sort((a, b) => {
      const ia = order.indexOf(a.key);
      const ib = order.indexOf(b.key);
      if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      return b.key.localeCompare(a.key, undefined, { numeric: true });
    });
  }, [conversations, lang, t]);
}

function ConversationItem({ c, active, streaming }: { c: Conversation; active: boolean; streaming: boolean }) {
  const t = useT();
  return (
    <div
      className={cn(
        'group relative flex items-center rounded-lg transition-colors',
        active ? 'bg-hover text-fg' : 'text-fg-muted hover:bg-muted hover:text-fg',
      )}
    >
      <button type="button" onClick={() => openConversation(c.id)} className="flex min-w-0 flex-1 items-center gap-2 py-2 pr-1 pl-2.5 text-left text-sm">
        {streaming && <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" />}
        <span className="truncate">{c.title || t('chat.newChat')}</span>
      </button>
      <Dropdown
        width={180}
        trigger={({ ref, onClick, open }) => (
          <button
            ref={ref}
            type="button"
            onClick={onClick}
            aria-label={t('common.more')}
            className={cn(
              'mr-1 flex size-7 shrink-0 items-center justify-center rounded-md text-fg-subtle hover:bg-line hover:text-fg',
              open || active ? 'opacity-100' : 'opacity-100 md:opacity-0 md:group-hover:opacity-100',
            )}
          >
            <MoreHorizontal className="size-4" />
          </button>
        )}
      >
        {(close) => (
          <>
            <MenuItem
              icon={<Pencil />}
              onClick={async () => {
                close();
                const title = await promptDialog({ title: t('chat.rename'), value: c.title });
                if (title?.trim()) updateConversation(c.id, { title: title.trim(), titleGenerated: true });
              }}
            >
              {t('chat.rename')}
            </MenuItem>
            <MenuItem
              icon={c.pinned ? <PinOff /> : <Pin />}
              onClick={() => {
                close();
                updateConversation(c.id, { pinned: !c.pinned });
              }}
            >
              {c.pinned ? t('chat.unpin') : t('chat.pin')}
            </MenuItem>
            <MenuDivider />
            <MenuItem
              danger
              icon={<Trash2 />}
              onClick={async () => {
                close();
                if (await confirmDialog({ title: t('chat.deleteConfirm'), message: c.title, danger: true, confirmText: t('common.delete') })) {
                  removeConversation(c.id);
                  if (useUI.getState().activeId === c.id) openConversation(null);
                }
              }}
            >
              {t('common.delete')}
            </MenuItem>
          </>
        )}
      </Dropdown>
    </div>
  );
}

function SyncIndicator() {
  const t = useT();
  const status = useData((s) => s.syncStatus);
  const error = useData((s) => s.syncError);
  const icon =
    status === 'syncing' ? (
      <RefreshCw className="size-3.5 animate-spin" />
    ) : status === 'offline' || status === 'error' ? (
      <CloudOff className="size-3.5 text-warning" />
    ) : (
      <Cloud className="size-3.5" />
    );
  const label = { idle: t('sync.idle'), syncing: t('sync.syncing'), offline: t('sync.offline'), error: t('sync.error') }[status];
  return (
    <span className="flex items-center gap-1 text-[11px] text-fg-subtle" title={error ? `${label}: ${error}` : label}>
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}

export function Sidebar() {
  const t = useT();
  const lang = useLang();
  const open = useUI((s) => s.sidebarOpen);
  const activeId = useUI((s) => s.activeId);
  const conversationsMap = useData((s) => s.conversations);
  const theme = useData((s) => s.settings.theme);
  const streaming = useChat((s) => s.streaming);
  const name = useDisplayName();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ conversationId: string; snippet: string }[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  const conversations = useMemo(() => Object.values(conversationsMap), [conversationsMap]);
  const query = q.trim().toLowerCase();
  const filtered = useMemo(() => (query ? conversations.filter((c) => c.title.toLowerCase().includes(query)) : conversations), [conversations, query]);
  const groups = useGroups(filtered, lang, t);

  useEffect(() => {
    if (query.length < 2) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const r = await api<{ results: { conversationId: string; snippet: string }[] }>(`/api/search?q=${encodeURIComponent(query)}`, { signal: ctrl.signal });
        setHits(r.results.filter((h) => conversationsMap[h.conversationId]));
      } catch {
        /* offline */
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query, conversationsMap]);

  useEffect(() => {
    const h = () => {
      useUI.setState({ sidebarOpen: true });
      setTimeout(() => searchRef.current?.focus(), 50);
    };
    window.addEventListener('omnichat:search', h);
    return () => window.removeEventListener('omnichat:search', h);
  }, []);

  const close = () => useUI.setState({ sidebarOpen: false });
  const titleIds = new Set(filtered.map((c) => c.id));
  const contentHits = hits.filter((h) => !titleIds.has(h.conversationId));
  const nextTheme: Record<ThemeMode, ThemeMode> = { system: 'light', light: 'dark', dark: 'system' };
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;

  return (
    <>
      {open && <div className="anim-fade fixed inset-0 z-30 bg-black/40 md:hidden" onClick={close} />}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-[280px] max-w-[85vw] flex-col border-r border-line bg-soft transition-transform duration-200 md:static md:z-auto md:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full md:hidden',
        )}
      >
        <div className="safe-top flex h-14 shrink-0 items-center gap-2 px-3">
          <button type="button" className="flex items-center gap-2 rounded-lg px-1 py-1" onClick={() => openConversation(null)}>
            <Logo className="size-7" />
            <span className="text-[15px] font-semibold tracking-tight">CatGPT</span>
          </button>
          <div className="ml-auto flex items-center">
            <IconButton aria-label={t('sidebar.collapse')} title={t('sidebar.collapse')} onClick={close}>
              <PanelLeftClose />
            </IconButton>
          </div>
        </div>

        <div className="space-y-2 px-3 pb-2">
          <button
            type="button"
            onClick={() => openConversation(null)}
            className="focus-ring flex h-10 w-full items-center gap-2 rounded-xl border border-line bg-bg px-3 text-sm font-medium text-fg shadow-sm transition-colors hover:bg-muted"
          >
            <SquarePen className="size-4" />
            {t('chat.newChat')}
            <span className="ml-auto hidden text-[11px] font-normal text-fg-subtle md:inline">{isMac() ? '⌘⇧O' : 'Ctrl+Shift+O'}</span>
          </button>
          <div className="flex h-9 items-center gap-2 rounded-xl bg-muted px-3">
            <Search className="size-4 shrink-0 text-fg-subtle" />
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('sidebar.search')}
              className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-subtle"
            />
            {q && (
              <button type="button" onClick={() => setQ('')} className="text-fg-subtle hover:text-fg" aria-label={t('common.clear')}>
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {groups.map((g) => (
            <div key={g.key} className="mb-2">
              <div className="sticky top-0 z-[1] bg-soft px-2.5 pt-2 pb-1 text-xs font-medium text-fg-subtle">{g.label}</div>
              {g.items.map((c) => (
                <ConversationItem key={c.id} c={c} active={c.id === activeId} streaming={!!streaming[c.id]} />
              ))}
            </div>
          ))}
          {contentHits.length > 0 && (
            <div className="mb-2">
              <div className="px-2.5 pt-2 pb-1 text-xs font-medium text-fg-subtle">{t('sidebar.inMessages')}</div>
              {contentHits.map((h) => (
                <button
                  key={h.conversationId}
                  type="button"
                  onClick={() => openConversation(h.conversationId)}
                  className="block w-full rounded-lg px-2.5 py-2 text-left hover:bg-muted"
                >
                  <div className="truncate text-sm text-fg">{conversationsMap[h.conversationId]?.title}</div>
                  <div className="line-clamp-2 text-xs text-fg-subtle">{h.snippet}</div>
                </button>
              ))}
            </div>
          )}
          {!groups.length && !contentHits.length && (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-fg-subtle">
              <MessageSquareText className="size-6" />
              {query ? t('sidebar.noResults') : t('sidebar.empty')}
            </div>
          )}
        </nav>

        <div className="safe-bottom border-t border-line p-2">
          <div className="flex items-center gap-1">
            <Dropdown
              align="start"
              width={240}
              trigger={({ ref, onClick }) => (
                <button ref={ref} type="button" onClick={onClick} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2 py-1.5 text-left hover:bg-muted">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-fg">
                    {(name || '?').slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-fg">{name}</span>
                    <SyncIndicator />
                  </span>
                </button>
              )}
            >
              {(closeMenu) => (
                <>
                  <MenuItem
                    icon={<Settings />}
                    onClick={() => {
                      closeMenu();
                      openSettings();
                    }}
                  >
                    {t('settings.title')}
                  </MenuItem>
                  <MenuDivider />
                  <MenuItem
                    danger
                    icon={<LogOut />}
                    onClick={async () => {
                      closeMenu();
                      if (await confirmDialog({ title: t('account.logoutConfirm'), confirmText: t('account.logout') })) await logout();
                    }}
                  >
                    {t('account.logout')}
                  </MenuItem>
                </>
              )}
            </Dropdown>
            <IconButton title={t(`theme.${theme}` as 'theme.system')} aria-label={t('settings.theme')} onClick={() => updateSettings({ theme: nextTheme[theme] })}>
              <ThemeIcon />
            </IconButton>
            <IconButton title={t('settings.title')} aria-label={t('settings.title')} onClick={() => openSettings()}>
              <Settings />
            </IconButton>
          </div>
        </div>
      </aside>
    </>
  );
}
