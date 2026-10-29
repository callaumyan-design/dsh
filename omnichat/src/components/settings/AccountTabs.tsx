import { useCallback, useEffect, useState } from 'react';
import { CloudUpload, DatabaseBackup, Download, KeyRound, LogOut, Monitor, ShieldCheck, Smartphone, Trash2 } from 'lucide-react';
import { Badge, Button, Field, IconButton, Input, Row, Switch } from '@/components/ui/primitives';
import { api, getToken } from '@/lib/api';
import { pendingCount } from '@/lib/sync';
import { cn, downloadFile, formatBytes, isMac } from '@/lib/utils';
import { displayName, logout, useAuth, useDisplayName } from '@/store/auth';
import { updateSettings, useData } from '@/store/data';
import { confirmDialog, promptDialog, toast } from '@/store/ui';
import { useLang, useT } from '@/i18n';
import { APP_VERSION } from '../../../shared/types';
import { Logo } from '@/components/layout/Logo';

interface SessionInfo {
  id: string;
  userAgent: string;
  ip: string;
  createdAt: number;
  lastSeen: number;
  current: boolean;
}

function describeUA(ua: string) {
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return [browser, os].filter(Boolean).join(' · ') || ua.slice(0, 40) || 'Unknown';
}

export function AccountTab() {
  const t = useT();
  const lang = useLang();
  const user = useAuth((s) => s.user);
  const name = useDisplayName();
  const nickname = useData((s) => s.settings.nickname) ?? '';
  const [nickDraft, setNickDraft] = useState(nickname);
  useEffect(() => setNickDraft(nickname), [nickname]);
  const saveNickname = () => {
    const v = nickDraft.trim().slice(0, 40);
    if (v !== nickname) updateSettings({ nickname: v || undefined });
  };
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [saving, setSaving] = useState(false);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);

  const loadSessions = useCallback(async () => {
    try {
      setSessions((await api<{ sessions: SessionInfo[] }>('/api/auth/sessions')).sessions);
    } catch {
      /* offline */
    }
  }, []);
  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const fmt = (ts: number) => new Date(ts).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US');

  return (
    <div className="space-y-6 p-5">
      <div className="flex items-center gap-3">
        <span className="flex size-12 items-center justify-center rounded-full bg-accent text-lg font-semibold text-accent-fg">
          {(name || '?').slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-semibold">
            <span className="truncate">{name}</span>
            {user?.isAdmin && <Badge className="bg-accent-soft text-accent">{t('account.admin')}</Badge>}
          </div>
          <div className="truncate text-xs text-fg-subtle">
            {user && `${t('account.loginName')} ${user.username} · ${t('account.since', { date: fmt(user.createdAt) })}`}
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          icon={<LogOut className="size-4" />}
          onClick={async () => {
            if (pendingCount() > 0 && !(await confirmDialog({ title: t('account.pendingLogout'), danger: true }))) return;
            await logout();
          }}
        >
          {t('account.logout')}
        </Button>
      </div>

      <Field label={t('account.nickname')} hint={t('account.nicknameHint')}>
        <Input
          value={nickDraft}
          maxLength={40}
          placeholder={displayName(user?.username)}
          onChange={(e) => setNickDraft(e.target.value)}
          onBlur={saveNickname}
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
        />
      </Field>

      <form
        className="space-y-3 rounded-xl border border-line p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          try {
            await api('/api/auth/password', { body: { oldPassword: oldPw, newPassword: newPw } });
            setOldPw('');
            setNewPw('');
            toast(t('account.passwordChanged'), 'success');
            void loadSessions();
          } catch (err) {
            toast((err as Error).message, 'error');
          } finally {
            setSaving(false);
          }
        }}
      >
        <div className="flex items-center gap-2 text-sm font-medium">
          <KeyRound className="size-4" />
          {t('account.changePassword')}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('account.oldPassword')}>
            <Input type="password" autoComplete="current-password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
          </Field>
          <Field label={t('account.newPassword')}>
            <Input type="password" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          </Field>
        </div>
        <Button type="submit" size="sm" variant="primary" loading={saving} disabled={!oldPw || newPw.length < 8}>
          {t('account.updatePassword')}
        </Button>
      </form>

      <div>
        <div className="mb-2 text-sm font-medium">{t('account.devices')}</div>
        <p className="mb-3 text-xs text-fg-subtle">{t('account.devicesDesc')}</p>
        <div className="divide-y divide-line rounded-xl border border-line">
          {sessions.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-3 py-2.5">
              {/Mobile|iPhone|Android/.test(s.userAgent) ? <Smartphone className="size-5 text-fg-muted" /> : <Monitor className="size-5 text-fg-muted" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm">
                  {describeUA(s.userAgent)}
                  {s.current && <Badge className="bg-success/15 text-success">{t('account.thisDevice')}</Badge>}
                </div>
                <div className="truncate text-xs text-fg-subtle">
                  {s.ip} · {t('account.lastActive', { date: fmt(s.lastSeen) })}
                </div>
              </div>
              {!s.current && (
                <IconButton
                  size="sm"
                  aria-label={t('account.revoke')}
                  title={t('account.revoke')}
                  onClick={async () => {
                    await api(`/api/auth/sessions/${s.id}`, { method: 'DELETE' });
                    void loadSessions();
                  }}
                >
                  <LogOut />
                </IconButton>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface BackupState {
  supported: boolean;
  backups?: { name: string; size: number; createdAt: number }[];
  remote?: string | null;
  lastRemote?: { at: number; ok: boolean; error?: string };
  running?: boolean;
}

/** Daily server backups: status, "back up now", and downloads of the local copies. */
function BackupsSection() {
  const t = useT();
  const lang = useLang();
  const [state, setState] = useState<BackupState | null>(null);
  const [busy, setBusy] = useState(false);
  const fmt = (ts: number) => new Date(ts).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US');

  useEffect(() => {
    api<BackupState>('/api/admin/backups').then(setState, () => setState({ supported: false }));
  }, []);
  if (!state?.supported) return null;

  const runNow = async () => {
    setBusy(true);
    try {
      setState(await api<BackupState>('/api/admin/backups', { method: 'POST' }));
      toast(t('backup.done'), 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const download = async (name: string) => {
    try {
      const res = await fetch(`/api/admin/backups/${encodeURIComponent(name)}`, { headers: { authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new Error(`${res.status}`);
      downloadFile(name, await res.blob());
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  const latest = state.backups?.[0];

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <DatabaseBackup className="size-4" />
          {t('backup.title')}
        </div>
        <Button size="sm" variant="outline" loading={busy} onClick={runNow}>
          {t('backup.now')}
        </Button>
      </div>
      <div className="space-y-3 rounded-xl border border-line p-3 text-sm">
        <div className="text-xs leading-relaxed text-fg-subtle">{t('backup.desc')}</div>
        <div className="flex items-start gap-2">
          <CloudUpload className={cn('mt-0.5 size-4 shrink-0', state.remote ? (state.lastRemote?.ok === false ? 'text-danger' : 'text-success') : 'text-fg-subtle')} />
          <div className="min-w-0 text-xs leading-relaxed">
            {state.remote ? (
              <>
                <div className="break-all text-fg">{t('backup.remoteOn', { url: state.remote })}</div>
                {state.lastRemote && (
                  <div className={state.lastRemote.ok ? 'text-fg-subtle' : 'break-all text-danger'}>
                    {state.lastRemote.ok ? t('backup.remoteOk', { date: fmt(state.lastRemote.at) }) : t('backup.remoteFail', { error: state.lastRemote.error ?? '' })}
                  </div>
                )}
              </>
            ) : (
              <div className="text-fg-subtle">{t('backup.remoteOff')}</div>
            )}
          </div>
        </div>
        {latest ? (
          <div className="divide-y divide-line rounded-lg border border-line">
            {state.backups!.map((b) => (
              <div key={b.name} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{fmt(b.createdAt)}</div>
                  <div className="text-xs text-fg-subtle">{formatBytes(b.size)}</div>
                </div>
                <IconButton size="sm" title={t('backup.download')} aria-label={t('backup.download')} onClick={() => void download(b.name)}>
                  <Download />
                </IconButton>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-fg-subtle">{t('backup.none')}</div>
        )}
      </div>
    </div>
  );
}

interface AdminUser {
  id: string;
  username: string;
  isAdmin: boolean;
  createdAt: number;
  conversations: number;
}

export function AdminTab() {
  const t = useT();
  const me = useAuth((s) => s.user);
  const [allowRegister, setAllowRegister] = useState(false);
  const [users, setUsers] = useState<AdminUser[]>([]);

  const load = useCallback(async () => {
    try {
      const [cfg, us] = await Promise.all([api<{ allowRegister: boolean }>('/api/admin/config'), api<{ users: AdminUser[] }>('/api/admin/users')]);
      setAllowRegister(cfg.allowRegister);
      setUsers(us.users);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-5 p-5">
      <div className="rounded-xl border border-line px-4">
        <Row title={t('admin.allowRegister')} desc={t('admin.allowRegisterDesc')}>
          <Switch
            checked={allowRegister}
            onChange={async (v) => {
              const r = await api<{ allowRegister: boolean }>('/api/admin/config', { method: 'PUT', body: { allowRegister: v } });
              setAllowRegister(r.allowRegister);
            }}
          />
        </Row>
      </div>
      <div>
        <div className="mb-2 text-sm font-medium">{t('admin.users')}</div>
        <div className="divide-y divide-line rounded-xl border border-line">
          {users.map((u) => (
            <div key={u.id} className="flex items-center gap-3 px-3 py-2.5">
              <span className="flex size-8 items-center justify-center rounded-full bg-muted text-sm font-semibold">{u.username.slice(0, 1).toUpperCase()}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {u.username}
                  {u.isAdmin && <ShieldCheck className="size-3.5 text-accent" />}
                </div>
                <div className="text-xs text-fg-subtle">{t('admin.userStats', { n: u.conversations, date: new Date(u.createdAt).toLocaleDateString() })}</div>
              </div>
              <IconButton
                size="sm"
                title={t('admin.resetPassword')}
                aria-label={t('admin.resetPassword')}
                onClick={async () => {
                  const pw = await promptDialog({ title: t('admin.resetPasswordFor', { name: u.username }), value: '', placeholder: t('account.newPassword') });
                  if (!pw) return;
                  try {
                    await api(`/api/admin/users/${u.id}/password`, { body: { password: pw } });
                    toast(t('account.passwordChanged'), 'success');
                  } catch (err) {
                    toast((err as Error).message, 'error');
                  }
                }}
              >
                <KeyRound />
              </IconButton>
              {u.id !== me?.id && (
                <IconButton
                  size="sm"
                  title={t('common.delete')}
                  aria-label={t('common.delete')}
                  onClick={async () => {
                    if (await confirmDialog({ title: t('admin.deleteUser', { name: u.username }), message: t('data.irreversible'), danger: true, confirmText: t('common.delete') })) {
                      await api(`/api/admin/users/${u.id}`, { method: 'DELETE' });
                      void load();
                    }
                  }}
                >
                  <Trash2 />
                </IconButton>
              )}
            </div>
          ))}
        </div>
      </div>
      <BackupsSection />
    </div>
  );
}

export function AboutTab() {
  const t = useT();
  const status = useData((s) => s.syncStatus);
  const mod = isMac() ? '⌘' : 'Ctrl';
  const shortcuts: [string, string][] = [
    [`${mod} + Shift + O`, t('about.scNew')],
    [`${mod} + K`, t('about.scSearch')],
    [`${mod} + ,`, t('about.scSettings')],
    [`${mod} + Shift + S`, t('about.scSidebar')],
    ['Shift + Enter', t('about.scNewline')],
  ];
  return (
    <div className="space-y-6 p-5">
      <div className="flex items-center gap-3">
        <Logo className="size-12" />
        <div>
          <div className="text-lg font-semibold">CatGPT</div>
          <div className="text-xs text-fg-subtle">
            v{APP_VERSION} · {t('about.syncStatus')}: {t(`sync.${status}` as 'sync.idle')}
          </div>
        </div>
      </div>
      <p className="text-sm leading-relaxed text-fg-muted">{t('about.desc')}</p>
      <div>
        <div className="mb-2 text-sm font-medium">{t('about.shortcuts')}</div>
        <div className="divide-y divide-line rounded-xl border border-line">
          {shortcuts.map(([k, d]) => (
            <div key={k} className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="text-fg-muted">{d}</span>
              <kbd className="rounded-md border border-line bg-muted px-1.5 py-0.5 font-mono text-xs">{k}</kbd>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-xl bg-muted p-4 text-xs leading-relaxed text-fg-muted">{t('about.privacy')}</div>
    </div>
  );
}
