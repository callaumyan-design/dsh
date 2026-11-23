import { ArrowRight, Bluetooth, BluetoothOff, CardSim, ChevronRight, Cpu, HardDrive, RefreshCw, ShieldCheck, Wifi, WifiOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { CompatibilityNotice } from '@/components/app/CompatibilityNotice';
import { ConnectionControls } from '@/components/app/ConnectionControls';
import { KeyValue, PageHeader } from '@/components/app/PageHeader';
import { SensitiveValue } from '@/components/app/SensitiveValue';
import { useAction } from '@/components/app/useAction';
import { useReady, useSession, useSessionController } from '@/hooks/session';
import type { Route } from '@/hooks/useRoute';
import { enabledProfile } from '@/lib/euicc/parse';
import { formatBytes } from '@/lib/utils';

export function rssiLabel(rssi: number | null | undefined): string {
  if (rssi === null || rssi === undefined || rssi === 0) return '—';
  if (rssi >= -55) return `${rssi} dBm · 强`;
  if (rssi >= -70) return `${rssi} dBm · 中`;
  return `${rssi} dBm · 弱`;
}

function StatCard({ icon, title, value, sub, tone = 'default' }: { icon: React.ReactNode; title: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'default' | 'success' | 'warning' | 'muted' }) {
  const toneCls = { default: 'bg-primary/10 text-primary', success: 'bg-success/15 text-success', warning: 'bg-warning/20 text-warning-foreground dark:text-warning', muted: 'bg-muted text-muted-foreground' }[tone];
  return (
    <Card className="gap-3 py-4">
      <CardContent className="flex items-start gap-3 px-4">
        <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg [&_svg]:size-5 ${toneCls}`}>{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground">{title}</div>
          <div className="mt-0.5 truncate font-semibold">{value}</div>
          {sub && <div className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

function Welcome() {
  return (
    <Card className="overflow-hidden">
      <CardContent className="grid gap-6 md:grid-cols-[1.2fr_1fr] md:items-center">
        <div className="space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <ShieldCheck className="size-3.5" /> 本地直连 · 无服务器 · 无需小程序
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">连接你的 9eSIM 蓝牙读卡器</h2>
          <ol className="space-y-2 text-sm text-muted-foreground">
            <li>1. 打开读卡器电源，确认蓝灯闪烁；关闭手机上的微信小程序，避免它占用蓝牙连接。</li>
            <li>2. 点击“连接读卡器”，在浏览器弹窗中选择 <code className="rounded bg-muted px-1 font-mono text-foreground">eSIM_Writer</code>。</li>
            <li>3. 连接后只会自动发送只读命令（读取设备信息、芯片信息和 Profile 列表）。</li>
          </ol>
          <ConnectionControls size="lg" />
          <p className="text-xs text-muted-foreground">找不到设备？用“显示所有设备”，系统可能缓存了别的名字。</p>
        </div>
        <div className="hidden rounded-xl border bg-gradient-to-br from-primary/10 via-accent/40 to-transparent p-6 md:block">
          <div className="space-y-3 text-sm">
            {[
              ['浏览器', 'Chrome / Edge（桌面版或 Android）'],
              ['蓝牙服务', 'Nordic UART 6E400001…'],
              ['协议', '旧版 eLPA：JSON 控制命令 + lpac CLI'],
              ['安全', '写操作全部需要二次确认'],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3 border-b border-border/60 pb-2 last:border-0">
                <span className="text-muted-foreground">{k}</span>
                <span className="text-right font-medium">{v}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function DashboardPage({ navigate }: { navigate: (r: Route) => void }) {
  const session = useSessionController();
  const { connected, ready } = useReady();
  const transport = useSession((s) => s.transport);
  const protocol = useSession((s) => s.protocol);
  const device = useSession((s) => s.device);
  const card = useSession((s) => s.card);
  const op = useSession((s) => s.operation);
  const { pending, run } = useAction();

  const active = enabledProfile(card.profiles);
  const info2 = card.chip?.euiccInfo2;
  const loadingCard = op?.key === 'chip.info' || op?.key === 'profile.list';

  const refreshAll = () =>
    run(
      'refresh',
      async () => {
        if (protocol.active === 'legacy-elpa') await session.refreshDevice();
        await session.refreshCard();
      },
      { success: '已刷新' },
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title="仪表盘"
        description="读卡器、eUICC 与已安装 Profile 的实时状态（数据均来自设备的真实回复）。"
        actions={
          connected && (
            <>
              <Button variant="outline" onClick={refreshAll} disabled={!ready || op !== null || pending !== null}>
                <RefreshCw className={loadingCard ? 'animate-spin' : ''} />
                刷新
              </Button>
              <ConnectionControls showAll={false} />
            </>
          )
        }
      />
      <CompatibilityNotice />

      {!connected && <Welcome />}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={connected ? <Bluetooth /> : <BluetoothOff />}
          title="蓝牙连接"
          tone={connected ? 'success' : 'muted'}
          value={connected ? '已连接' : transport.state === 'connecting' ? '连接中…' : '未连接'}
          sub={transport.deviceName ?? (transport.lastError ? transport.lastError : '尚未选择设备')}
        />
        <StatCard
          icon={<Cpu />}
          title="读卡器固件"
          tone={device.info ? 'default' : 'muted'}
          value={device.info?.software ? `v${device.info.software}` : connected && protocol.status === 'probing' ? '读取中…' : '—'}
          sub={device.info ? `硬件 ${device.info.hardware ?? '?'} · 固件 ${device.info.firmware ?? '?'}` : protocol.active === 'apdu-json' ? 'APDU 协议不提供设备信息' : '连接后读取'}
        />
        <StatCard
          icon={device.wifi?.connected ? <Wifi /> : <WifiOff />}
          title="读卡器 Wi-Fi"
          tone={device.wifi ? (device.wifi.connected ? 'success' : 'warning') : 'muted'}
          value={device.wifi ? (device.wifi.connected ? '已联网' : '未联网') : '—'}
          sub={device.wifi ? `${device.wifi.ssid || '(未配置)'} · ${rssiLabel(device.wifi.connected ? device.wifi.rssi : null)}` : '下载 eSIM 需要读卡器联网'}
        />
        <StatCard
          icon={<CardSim />}
          title="SIM 卡"
          tone={card.inserted === true ? 'success' : card.inserted === false ? 'warning' : 'muted'}
          value={card.inserted === true ? '已插入 eUICC' : card.inserted === false ? '未插卡' : loadingCard ? '读取中…' : '未知'}
          sub={card.profiles ? `${card.profiles.length} 个 Profile` : card.inserted === false ? '插卡后点击刷新' : '读取芯片信息后显示'}
        />
      </div>

      {connected && (
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>eUICC 芯片</CardTitle>
              <CardDescription>来自 lpac chip info（ES10c GetEID / EUICCInfo2）</CardDescription>
              <CardAction>
                <Button variant="ghost" size="sm" onClick={() => run('chip', () => session.readChipInfo(), { success: '芯片信息已更新' })} disabled={!ready || op !== null}>
                  <RefreshCw /> 读取
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {loadingCard && !card.chip ? (
                <div className="space-y-3">
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-5 w-4/5" />
                  <Skeleton className="h-5 w-3/5" />
                </div>
              ) : card.chip ? (
                <dl className="divide-y">
                  <KeyValue label="EID">
                    <SensitiveValue value={card.chip.eid} label="EID" />
                  </KeyValue>
                  <KeyValue label="剩余存储（NVM）">{formatBytes(info2?.extCardResource?.freeNonVolatileMemory)}</KeyValue>
                  <KeyValue label="已安装应用数">{info2?.extCardResource?.installedApplication ?? '—'}</KeyValue>
                  <KeyValue label="SGP.22 版本" hint="svn">{info2?.svn ?? '—'}</KeyValue>
                  <KeyValue label="eUICC 固件">{info2?.euiccFirmwareVer ?? '—'}</KeyValue>
                  <KeyValue label="默认 SM-DP+">{card.chip.defaultDpAddress ?? <span className="text-muted-foreground">未设置</span>}</KeyValue>
                  <KeyValue label="根 SM-DS">{card.chip.rootDsAddress ?? '—'}</KeyValue>
                  {info2?.rspCapability.length ? (
                    <KeyValue label="RSP 能力">
                      <div className="flex flex-wrap justify-end gap-1">
                        {info2.rspCapability.map((c) => (
                          <Badge key={c} variant="muted">
                            {c}
                          </Badge>
                        ))}
                      </div>
                    </KeyValue>
                  ) : null}
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground">{card.inserted === false ? '读卡器报告未插卡。' : ready ? '尚未读取。' : protocol.detail ?? '等待协议识别。'}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>当前启用的 Profile</CardTitle>
              <CardDescription>{card.profiles ? `共 ${card.profiles.length} 个，已启用 ${card.profiles.filter((p) => p.state === 'enabled').length} 个` : '读取 Profile 列表后显示'}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {active ? (
                <div className="rounded-lg border border-success/30 bg-success/5 p-4">
                  <div className="flex items-center gap-2">
                    <Badge variant="success">已启用</Badge>
                    <span className="truncate font-medium">{active.nickname ?? active.profileName ?? '未命名'}</span>
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground">{active.serviceProviderName ?? '未知运营商'}</div>
                  <div className="mt-1 text-sm">
                    <SensitiveValue value={active.iccid} label="ICCID" />
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{card.profiles ? '没有启用的 Profile。' : '—'}</p>
              )}
              <Button variant="outline" className="w-full" onClick={() => navigate('profiles')} disabled={!card.profiles}>
                管理 Profiles <ChevronRight />
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => navigate('install')}>
                <HardDrive /> 安装新的 eSIM <ArrowRight />
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
