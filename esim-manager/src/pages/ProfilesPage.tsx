import { useState } from 'react';
import { Bell, CardSim, CircleCheck, CirclePause, LoaderCircle, Pencil, Power, RefreshCw, Send, Trash2, TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/app/ConfirmDialog';
import { RequireReady } from '@/components/app/NotConnected';
import { EmptyState, PageHeader } from '@/components/app/PageHeader';
import { SensitiveValue } from '@/components/app/SensitiveValue';
import { useAction } from '@/components/app/useAction';
import { useSession, useSessionController } from '@/hooks/session';
import type { EuiccProfile } from '@/lib/euicc/types';
import { CommandValidationError, validateNickname } from '@/lib/protocol/legacy/commands';
import { cn, utf8ByteLength } from '@/lib/utils';

type Pending = { kind: 'enable' | 'disable' | 'delete' | 'rename'; profile: EuiccProfile } | null;

const CLASS_LABEL: Record<EuiccProfile['profileClass'], { label: string; variant: 'warning' | 'secondary' | 'muted' } | null> = {
  test: { label: '测试 Profile', variant: 'warning' },
  provisioning: { label: '预置 Profile', variant: 'secondary' },
  operational: null,
  unknown: null,
};

function ProfileIcon({ profile }: { profile: EuiccProfile }) {
  if (profile.icon && (profile.iconType === 'png' || profile.iconType === 'jpeg')) {
    return <img src={`data:image/${profile.iconType};base64,${profile.icon}`} alt="" className="size-11 shrink-0 rounded-lg border bg-white object-contain p-1" />;
  }
  const initial = [...(profile.serviceProviderName ?? profile.profileName ?? '?')][0]?.toUpperCase();
  return (
    <div className={cn('flex size-11 shrink-0 items-center justify-center rounded-lg text-lg font-semibold', profile.state === 'enabled' ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground')}>{initial}</div>
  );
}

function ProfileCard({ profile, disabled, onAction, writable }: { profile: EuiccProfile; disabled: boolean; onAction: (kind: NonNullable<Pending>['kind']) => void; writable: { enable: boolean; disable: boolean; delete: boolean; nickname: boolean } }) {
  const enabled = profile.state === 'enabled';
  const cls = CLASS_LABEL[profile.profileClass];
  return (
    <Card className={cn('gap-4 transition-shadow', enabled && 'border-success/50 ring-1 ring-success/20')} data-testid="profile-card" data-state={profile.state}>
      <CardHeader className="grid-cols-[auto_1fr] items-center gap-x-3 gap-y-0">
        <div className="row-span-2">
          <ProfileIcon profile={profile} />
        </div>
        <CardTitle className="truncate text-base">{profile.nickname ?? profile.profileName ?? '未命名 Profile'}</CardTitle>
        <CardDescription className="truncate">{profile.serviceProviderName ?? '未知运营商'}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {enabled ? (
            <Badge variant="success">
              <CircleCheck /> 已启用
            </Badge>
          ) : profile.state === 'disabled' ? (
            <Badge variant="muted">
              <CirclePause /> 已停用
            </Badge>
          ) : (
            <Badge variant="outline">状态未知</Badge>
          )}
          {cls && <Badge variant={cls.variant}>{cls.label}</Badge>}
        </div>
        <dl className="grid gap-1 text-sm">
          {profile.nickname && profile.profileName && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Profile 名称</dt>
              <dd className="truncate text-right">{profile.profileName}</dd>
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">ICCID</dt>
            <dd className="min-w-0">
              <SensitiveValue value={profile.iccid} label="ICCID" />
            </dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-2 border-t pt-3">
          {enabled ? (
            <Button size="sm" variant="outline" onClick={() => onAction('disable')} disabled={disabled || !writable.disable}>
              <Power /> 停用
            </Button>
          ) : (
            <Button size="sm" onClick={() => onAction('enable')} disabled={disabled || !writable.enable || profile.state !== 'disabled'}>
              <Power /> 启用
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => onAction('rename')} disabled={disabled || !writable.nickname}>
            <Pencil /> 昵称
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => onAction('delete')}
            disabled={disabled || !writable.delete || enabled}
            title={enabled ? '已启用的 Profile 需要先停用才能删除' : undefined}
          >
            <Trash2 /> 删除
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function RenameDialog({ profile, onClose, onSubmit }: { profile: EuiccProfile | null; onClose: () => void; onSubmit: (name: string) => Promise<unknown> }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastId, setLastId] = useState<string | null>(null);
  if (profile && profile.iccid !== lastId) {
    setLastId(profile.iccid);
    setName(profile.nickname ?? '');
  }
  let error: string | null = null;
  try {
    validateNickname(name);
  } catch (e) {
    error = e instanceof CommandValidationError ? e.message : String(e);
  }
  const submit = async () => {
    if (error || busy) return;
    setBusy(true);
    try {
      await onSubmit(name);
    } finally {
      setBusy(false);
      onClose();
    }
  };
  return (
    <Dialog open={profile !== null} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>修改昵称</DialogTitle>
          <DialogDescription>昵称保存在 eUICC 卡上（ES10c SetNickname）。留空表示清除昵称。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="nickname">昵称</Label>
          <Input id="nickname" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!error} maxLength={64} autoComplete="off" onKeyDown={(e) => e.key === 'Enter' && submit()} />
          <div className="flex justify-between text-xs">
            <span className={error ? 'text-destructive' : 'text-muted-foreground'}>{error ?? '旧版固件按空格切分参数，昵称中不能有空格。'}</span>
            <span className="text-muted-foreground tabular">{utf8ByteLength(name)}/64 字节</span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button onClick={submit} disabled={!!error || busy}>
            {busy && <LoaderCircle className="animate-spin" />}保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NotificationsCard() {
  const session = useSessionController();
  const notifications = useSession((s) => s.card.notifications);
  const op = useSession((s) => s.operation);
  const caps = useSession((s) => s.protocol.active);
  const { run } = useAction();
  const [confirm, setConfirm] = useState<'process' | 'process-remove' | 'remove' | null>(null);
  const supported = caps === 'legacy-elpa';
  const busy = op !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="size-4" /> 待发送通知
        </CardTitle>
        <CardDescription>安装、启用、停用、删除 Profile 后，eUICC 会生成需要发给运营商服务器的通知（SGP.22 ES9+ HandleNotification）。</CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm" disabled={!supported || busy} onClick={() => run('notif', () => session.readNotifications(), { silentSuccess: true })}>
            <RefreshCw /> 读取
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        {!supported ? (
          <p className="text-sm text-muted-foreground">当前协议不支持通知管理。</p>
        ) : notifications === null ? (
          <p className="text-sm text-muted-foreground">尚未读取（只读操作）。</p>
        ) : notifications.length === 0 ? (
          <p className="text-sm text-muted-foreground">没有待发送的通知。</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {notifications.map((n) => (
              <li key={n.seqNumber} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <span className="font-mono text-xs text-muted-foreground">#{n.seqNumber}</span>
                <Badge variant="secondary">{n.operation}</Badge>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{n.address ?? '—'}</span>
                {n.iccid && <SensitiveValue value={n.iccid} label="ICCID" className="text-xs" />}
              </li>
            ))}
          </ul>
        )}
        {supported && notifications && notifications.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setConfirm('process-remove')} disabled={busy}>
              <Send /> 发送并移除全部
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConfirm('process')} disabled={busy}>
              仅发送全部
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirm('remove')} disabled={busy}>
              移除全部（不发送）
            </Button>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          注：eLPA 2.x 固件处理单个序号的代码有缺陷（参数偏移计算错误，会什么都不做却报告成功），所以这里只提供对“全部”通知的操作（<code>-a</code>）。
        </p>
      </CardContent>
      <ConfirmDialog
        open={confirm === 'process' || confirm === 'process-remove'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === 'process-remove' ? '发送并移除全部通知？' : '发送全部通知？'}
        description={
          <>
            <p>读卡器会通过自己的 Wi-Fi 把通知发送到每条通知记录的服务器地址。</p>
            {confirm === 'process-remove' && <p>发送成功的通知会从 eUICC 中移除。</p>}
          </>
        }
        confirmLabel="发送"
        onConfirm={() => run('process', () => session.processAllNotifications(confirm === 'process-remove'), { success: '通知已处理' })}
      />
      <ConfirmDialog
        open={confirm === 'remove'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="移除全部通知而不发送？"
        destructive
        description={<p>运营商将收不到这些通知（例如安装成功的回执），可能影响其后台状态。移除后无法恢复。</p>}
        requireText="移除"
        confirmLabel="移除全部"
        onConfirm={() => run('remove', () => session.removeAllNotifications(), { success: '通知已移除' })}
      />
    </Card>
  );
}

export function ProfilesPage() {
  const session = useSessionController();
  const profiles = useSession((s) => s.card.profiles);
  const inserted = useSession((s) => s.card.inserted);
  const op = useSession((s) => s.operation);
  const protocol = useSession((s) => s.protocol.active);
  const { run } = useAction();
  const [pending, setPending] = useState<Pending>(null);

  const writable = protocol === 'legacy-elpa' ? { enable: true, disable: true, delete: true, nickname: true } : { enable: false, disable: false, delete: false, nickname: false };
  const loading = op?.key === 'profile.list';
  const busy = op !== null;
  const currentlyEnabled = profiles?.find((p) => p.state === 'enabled') ?? null;
  const sorted = profiles ? [...profiles].sort((a, b) => (a.state === 'enabled' ? -1 : b.state === 'enabled' ? 1 : 0)) : null;
  const label = (p: EuiccProfile) => p.nickname ?? p.profileName ?? p.serviceProviderName ?? '该 Profile';

  return (
    <div className="space-y-6">
      <PageHeader
        title="eSIM Profiles"
        description="卡上已安装的运营商配置文件。所有写操作都需要确认，完成后会重新读取列表核对。"
        actions={
          <Button variant="outline" onClick={() => run('list', () => session.readProfiles(), { success: (r) => `读取到 ${r.length} 个 Profile` })} disabled={busy || protocol === null}>
            <RefreshCw className={loading ? 'animate-spin' : ''} /> 刷新列表
          </Button>
        }
      />
      <RequireReady what="查看 Profile">
        {protocol === 'apdu-json' && (
          <Alert variant="info">
            <TriangleAlert />
            <AlertTitle>APDU JSON 协议：只读模式</AlertTitle>
            <AlertDescription>该协议在官方固件源码中不存在，尚未经过真实设备验证，因此只开放读取功能。</AlertDescription>
          </Alert>
        )}
        {inserted === false ? (
          <EmptyState icon={<CardSim />} title="读卡器报告未插卡">
            插入 eUICC 卡后点击“刷新列表”。
          </EmptyState>
        ) : sorted === null ? (
          loading ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-56 rounded-xl" />
              ))}
            </div>
          ) : (
            <EmptyState icon={<CardSim />} title="尚未读取 Profile 列表">
              点击“刷新列表”发送只读命令 <code>lpac profile list</code>。
            </EmptyState>
          )
        ) : sorted.length === 0 ? (
          <EmptyState icon={<CardSim />} title="这张卡上没有 Profile">
            可以在“安装 eSIM”页面用激活码下载。
          </EmptyState>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {sorted.map((p) => (
              <ProfileCard key={p.iccid || p.isdpAid} profile={p} disabled={busy} writable={writable} onAction={(kind) => setPending({ kind, profile: p })} />
            ))}
          </div>
        )}
        {protocol === 'legacy-elpa' && inserted !== false && <NotificationsCard />}
      </RequireReady>

      <ConfirmDialog
        open={pending?.kind === 'enable'}
        onOpenChange={(o) => !o && setPending(null)}
        title={`启用「${pending ? label(pending.profile) : ''}」？`}
        description={
          <>
            {currentlyEnabled && currentlyEnabled.iccid !== pending?.profile.iccid ? (
              <p>
                当前启用的「{label(currentlyEnabled)}」会被 eUICC 自动停用。插在手机里时，手机会短暂断网并重新注册。
              </p>
            ) : (
              <p>启用后，插入手机即可使用此 Profile。</p>
            )}
            <p className="text-xs">发送命令：lpac profile enable &lt;ICCID&gt;（固件默认不带 refreshFlag）。</p>
          </>
        }
        confirmLabel="启用"
        onConfirm={() => (pending ? run('enable', () => session.enableProfile(pending.profile.iccid), { success: '已启用' }) : undefined)}
      />
      <ConfirmDialog
        open={pending?.kind === 'disable'}
        onOpenChange={(o) => !o && setPending(null)}
        title={`停用「${pending ? label(pending.profile) : ''}」？`}
        description={<p>停用后该号码将无法使用，直到再次启用。Profile 本身不会被删除。</p>}
        confirmLabel="停用"
        onConfirm={() => (pending ? run('disable', () => session.disableProfile(pending.profile.iccid), { success: '已停用' }) : undefined)}
      />
      <ConfirmDialog
        open={pending?.kind === 'delete'}
        onOpenChange={(o) => !o && setPending(null)}
        title={`永久删除「${pending ? label(pending.profile) : ''}」？`}
        destructive
        description={
          <>
            <p className="font-medium text-destructive">删除后通常无法恢复。</p>
            <p>大多数运营商的激活码只能使用一次，删除后需要联系运营商重新办理（可能收费）。请确认你不再需要这个号码 / 套餐。</p>
            <p>删除会生成一条通知，建议之后在本页“待发送通知”中发送给运营商。</p>
          </>
        }
        requireText={pending ? pending.profile.iccid.slice(-4) : ''}
        requireTextLabel={`请输入该 Profile ICCID 的最后 4 位（${pending ? pending.profile.iccid.slice(-4) : ''}）以确认`}
        confirmLabel="永久删除"
        onConfirm={() => (pending ? run('delete', () => session.deleteProfile(pending.profile.iccid), { success: '已删除' }) : undefined)}
      />
      <RenameDialog
        profile={pending?.kind === 'rename' ? pending.profile : null}
        onClose={() => setPending(null)}
        onSubmit={(name) => (pending ? run('rename', () => session.setNickname(pending.profile.iccid, name), { success: '昵称已更新' }) : Promise.resolve())}
      />
    </div>
  );
}
