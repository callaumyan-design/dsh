import { useState } from 'react';
import { Cpu, Eye, EyeOff, Info, LoaderCircle, RefreshCw, ShieldOff, Wifi } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/app/ConfirmDialog';
import { RequireReady } from '@/components/app/NotConnected';
import { KeyValue, PageHeader } from '@/components/app/PageHeader';
import { SensitiveValue } from '@/components/app/SensitiveValue';
import { useAction } from '@/components/app/useAction';
import { useSession, useSessionController } from '@/hooks/session';
import { MAX_COMMAND_BYTES } from '@/lib/ble/constants';
import { CommandValidationError, commandBuilders } from '@/lib/protocol/legacy/commands';
import { utf8ByteLength } from '@/lib/utils';
import { rssiLabel } from './DashboardPage';

function WifiCard() {
  const session = useSessionController();
  const wifi = useSession((s) => s.device.wifi);
  const op = useSession((s) => s.operation);
  const { run } = useAction();
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [confirm, setConfirm] = useState(false);

  let error: string | null = null;
  let size = 0;
  if (ssid) {
    try {
      size = utf8ByteLength(commandBuilders.setWifiInfo(ssid, password));
    } catch (e) {
      error = e instanceof CommandValidationError ? e.message : String(e);
    }
  }

  const submit = async () => {
    const result = await session.setWifi(ssid, password);
    setPassword('');
    return result;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wifi className="size-4" /> 读卡器 Wi-Fi
        </CardTitle>
        <CardDescription>读卡器（ESP32-S3）通过 Wi-Fi 访问 SM-DP+ 下载 eSIM，只支持 2.4 GHz 网络。</CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm" onClick={() => run('wifi', () => session.refreshWifi(), { silentSuccess: true })} disabled={op !== null}>
            <RefreshCw /> 刷新
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-5">
        <dl className="divide-y">
          <KeyValue label="当前网络">{wifi?.ssid || <span className="text-muted-foreground">未配置</span>}</KeyValue>
          <KeyValue label="连接状态">{wifi ? wifi.connected ? <Badge variant="success">已连接</Badge> : <Badge variant="warning">未连接</Badge> : '—'}</KeyValue>
          <KeyValue label="信号">{rssiLabel(wifi?.connected ? wifi.rssi : null)}</KeyValue>
          <KeyValue label="密码" hint="设备会明文返回，本应用不显示也不记录">{wifi ? (wifi.hasPassword ? '已设置（已隐藏）' : '无') : '—'}</KeyValue>
          <KeyValue label="设备时间" hint="NTP 同步后才准确">{wifi?.deviceTime ?? '—'}</KeyValue>
        </dl>
        <form
          className="space-y-3 rounded-lg border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!error && ssid) setConfirm(true);
          }}
          autoComplete="off"
        >
          <div className="text-sm font-medium">修改 Wi-Fi</div>
          <div className="grid gap-2">
            <Label htmlFor="ssid">网络名称（SSID）</Label>
            <Input id="ssid" value={ssid} onChange={(e) => setSsid(e.target.value)} maxLength={32} autoComplete="off" spellCheck={false} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="wifi-pw">密码</Label>
            <div className="relative">
              <Input id="wifi-pw" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} className="pr-10" autoComplete="new-password" />
              <Button type="button" variant="ghost" size="icon-sm" className="absolute top-0.5 right-0.5" onClick={() => setShow((v) => !v)} aria-label={show ? '隐藏密码' : '显示密码'}>
                {show ? <EyeOff /> : <Eye />}
              </Button>
            </div>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className={error ? 'text-destructive' : 'text-muted-foreground'}>{error ?? '密码只通过蓝牙发送给读卡器，不保存、不记录。'}</span>
            {ssid && !error && (
              <span className="text-muted-foreground tabular">
                {size}/{MAX_COMMAND_BYTES} 字节
              </span>
            )}
          </div>
          <Button type="submit" disabled={!ssid || !!error || op !== null}>
            {op?.key === 'device.setWifi' && <LoaderCircle className="animate-spin" />}
            保存并连接
          </Button>
        </form>
      </CardContent>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`把读卡器 Wi-Fi 改为「${ssid}」？`}
        description={
          <>
            <p>读卡器会断开当前网络并尝试连接新网络，新的配置会保存在读卡器中。</p>
            <p>固件不会确认此命令，本应用随后会读取 Wi-Fi 状态检查是否连接成功（约 3–18 秒）。</p>
          </>
        }
        confirmLabel="保存"
        onConfirm={() => run('setwifi', submit, { success: (w) => (w.connected && w.ssid === ssid ? '读卡器已连接新的 Wi-Fi' : '已发送配置，但读卡器尚未连上该网络，请检查密码或信号') })}
      />
    </Card>
  );
}

export function SettingsPage() {
  const session = useSessionController();
  const device = useSession((s) => s.device);
  const transport = useSession((s) => s.transport);
  const settings = useSession((s) => s.settings);
  const protocol = useSession((s) => s.protocol.active);
  const op = useSession((s) => s.operation);
  const { run } = useAction();
  const [forget, setForget] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader title="设备设置" description="读卡器信息、Wi-Fi 配置与本应用的行为设置。" />

      <Card>
        <CardHeader>
          <CardTitle>应用行为</CardTitle>
          <CardDescription>仅保存在当前页面会话中，刷新页面后恢复默认。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="auto-identify">连接后自动识别协议</Label>
              <p className="mt-1 text-xs text-muted-foreground">发送只读命令 {'{"cmd":"getElpaInfo"}'}，用于确认设备运行的是官方旧版 eLPA 固件。</p>
            </div>
            <Switch id="auto-identify" checked={settings.autoIdentify} onCheckedChange={(v) => session.setSettings({ autoIdentify: v })} />
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="auto-read">识别后自动读取卡片</Label>
              <p className="mt-1 text-xs text-muted-foreground">发送只读命令 lpac chip info 与 lpac profile list。</p>
            </div>
            <Switch id="auto-read" checked={settings.autoReadCard} onCheckedChange={(v) => session.setSettings({ autoReadCard: v })} />
          </div>
          <p className="text-xs text-muted-foreground">无论如何设置，本应用都不会在页面加载或连接时自动发送任何写入命令。</p>
        </CardContent>
      </Card>

      <RequireReady what="查看读卡器设置">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cpu className="size-4" /> 读卡器信息
              </CardTitle>
              <CardDescription>来自 getElpaInfo</CardDescription>
              <CardAction>
                <Button variant="ghost" size="sm" onClick={() => run('info', () => session.refreshDevice(), { silentSuccess: true })} disabled={protocol !== 'legacy-elpa' || op !== null}>
                  <RefreshCw /> 刷新
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              <dl className="divide-y">
                <KeyValue label="蓝牙名称">{transport.deviceName ?? '—'}</KeyValue>
                <KeyValue label="软件版本">{device.info?.software ?? '—'}</KeyValue>
                <KeyValue label="固件版本">{device.info?.firmware ?? '—'}</KeyValue>
                <KeyValue label="硬件版本">{device.info?.hardware ?? '—'}</KeyValue>
                <KeyValue label="设备 ID（eFuse MAC）">
                  <SensitiveValue value={device.info?.mac} label="设备 ID" />
                </KeyValue>
                <KeyValue label="内置 lpac 版本">
                  {device.lpacVersion ?? (
                    <Button variant="link" className="h-auto p-0" disabled={op !== null || protocol !== 'legacy-elpa'} onClick={() => run('ver', () => session.readLpacVersion(), { silentSuccess: true })}>
                      读取
                    </Button>
                  )}
                </KeyValue>
              </dl>
            </CardContent>
          </Card>

          {protocol === 'legacy-elpa' ? (
            <WifiCard />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Wi-Fi</CardTitle>
                <CardDescription>当前协议不提供 Wi-Fi 配置命令。</CardDescription>
              </CardHeader>
            </Card>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Info className="size-4" /> 固件更新
            </CardTitle>
            <CardDescription>仅显示设备报告的信息，本应用不会发起 OTA。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <dl className="divide-y">
              <KeyValue label="设备报告有新版本">{device.info ? (device.info.hasNewSoftware ? <Badge variant="warning">是：{device.info.newSoftwareVersion}</Badge> : '否') : '—'}</KeyValue>
              {device.upgrade && (
                <KeyValue label="升级状态（设备推送）">
                  {device.upgrade.state} {device.upgrade.current}/{device.upgrade.total}
                </KeyValue>
              )}
            </dl>
            <Alert>
              <ShieldOff />
              <AlertTitle>为什么不提供“一键升级”</AlertTitle>
              <AlertDescription>
                <p>
                  固件的 upgradeSoftware / checkUpdate 命令会让读卡器从一个 URL 下载并刷写固件；公开源码里的默认地址是占位符（example.com），实际地址无法核实。
                  为避免把设备刷坏或刷入未经验证的固件，本应用不发送这两个命令。
                </p>
                <p>如需升级，请参考 9esim/MiniToolFirmware 仓库的官方说明，通过 USB 串口用 esptool / Flash Download Tool 手动刷写。</p>
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </RequireReady>

      {transport.deviceId && (
        <Card>
          <CardHeader>
            <CardTitle>浏览器授权</CardTitle>
            <CardDescription>撤销本站点对此蓝牙设备的访问权限（Chrome 101+）。</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => setForget(true)} disabled={op?.write === true}>
              撤销设备授权
            </Button>
          </CardContent>
        </Card>
      )}
      <ConfirmDialog
        open={forget}
        onOpenChange={setForget}
        title="撤销设备授权？"
        description={<p>会断开连接并让浏览器忘记该设备，下次需要重新在设备选择器中选择。</p>}
        confirmLabel="撤销"
        onConfirm={() => run('forget', () => session.forgetDevice(), { success: '已撤销授权' })}
      />
    </div>
  );
}
