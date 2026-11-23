import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, CircleCheck, CircleX, Download, ImageUp, KeyRound, LoaderCircle, QrCode, RefreshCw, Search, Server, ShieldCheck, Wifi, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/app/ConfirmDialog';
import { RequireReady } from '@/components/app/NotConnected';
import { PageHeader } from '@/components/app/PageHeader';
import { QrScanDialog } from '@/components/app/QrScanDialog';
import { useAction } from '@/components/app/useAction';
import { useSession, useSessionController } from '@/hooks/session';
import type { Route } from '@/hooks/useRoute';
import { ActivationCodeError, DOWNLOAD_STAGES, DOWNLOAD_TOTAL_STEPS, parseActivationCode, validateConfirmationCode, type ParsedActivationCode } from '@/lib/euicc/activationCode';
import { maskId } from '@/lib/protocol/redact';
import { decodeQrFromBlob, extractActivationCode } from '@/lib/qr/qr';
import { cn, errorMessage } from '@/lib/utils';
import { rssiLabel } from './DashboardPage';

const STEP_ORDER = [
  'es10b_get_euicc_challenge_and_info',
  'es9p_initiate_authentication',
  'es10b_authenticate_server',
  'es9p_authenticate_client',
  'es10b_prepare_download',
  'es9p_get_bound_profile_package',
  'es10b_load_bound_profile_package',
];

type Outcome = { ok: true } | { ok: false; message: string } | null;

export function InstallPage({ navigate }: { navigate: (r: Route) => void }) {
  const session = useSessionController();
  const wifi = useSession((s) => s.device.wifi);
  const op = useSession((s) => s.operation);
  const caps = useSession((s) => s.protocol.active);
  const discovery = useSession((s) => s.card.discovery);
  const { run } = useAction();

  const [code, setCode] = useState('');
  const [confirmationCode, setConfirmationCode] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [stagesSeen, setStagesSeen] = useState<string[]>([]);
  const [scanOpen, setScanOpen] = useState(false);
  const [decoding, setDecoding] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [fromQr, setFromQr] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const locked = op?.key === 'profile.download';

  /** 识别成功：填入激活码。激活码不写日志、不保存。 */
  const applyCode = useCallback((ac: string) => {
    setCode(ac);
    setFromQr(true);
    setOutcome(null);
    toast.success('已从二维码读取激活码，请核对 SM-DP+ 地址');
  }, []);

  const decodeImage = useCallback(
    async (file: Blob) => {
      if (locked) return;
      setDecoding(true);
      try {
        applyCode(extractActivationCode(await decodeQrFromBlob(file)));
      } catch (e) {
        toast.error(errorMessage(e), { duration: 8000 });
      } finally {
        setDecoding(false);
      }
    },
    [applyCode, locked],
  );

  // 整个页面都可以拖入图片；按 Ctrl+V / ⌘V 粘贴截图
  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current++;
      setDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const file = Array.from(e.dataTransfer?.files ?? []).find((f) => f.type.startsWith('image/'));
      if (file) void decodeImage(file);
      else toast.error('请拖入二维码图片（PNG、JPG、WebP 等）。');
    };
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.kind === 'file' && i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (!file) return; // 文字粘贴保持浏览器默认行为
      e.preventDefault();
      void decodeImage(file);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('paste', onPaste);
    };
  }, [decodeImage]);

  const parsed = useMemo((): { value: ParsedActivationCode | null; error: string | null } => {
    if (!code.trim()) return { value: null, error: null };
    try {
      return { value: parseActivationCode(code), error: null };
    } catch (e) {
      return { value: null, error: e instanceof ActivationCodeError ? e.message : errorMessage(e) };
    }
  }, [code]);

  const ccError = useMemo(() => {
    if (!parsed.value?.confirmationCodeRequired && !confirmationCode) return null;
    try {
      validateConfirmationCode(confirmationCode);
      return null;
    } catch (e) {
      return errorMessage(e);
    }
  }, [parsed.value, confirmationCode]);

  const downloading = op?.key === 'profile.download';
  const progress = downloading ? op.progress : null;
  if (progress && !stagesSeen.includes(progress.stage)) setStagesSeen([...stagesSeen, progress.stage]);

  const supported = caps === 'legacy-elpa';
  const wifiOk = wifi?.connected === true;
  const canStart = supported && !!parsed.value && !ccError && wifiOk && op === null;

  const start = async () => {
    setOutcome(null);
    setStagesSeen([]);
    try {
      await session.downloadProfile({ activationCode: code, confirmationCode: confirmationCode || null });
      setOutcome({ ok: true });
      setCode('');
      setConfirmationCode('');
    } catch (e) {
      setOutcome({ ok: false, message: errorMessage(e) });
      throw e;
    }
  };

  const pct = progress?.step ? Math.round((progress.step / (progress.totalSteps ?? DOWNLOAD_TOTAL_STEPS)) * 100) : downloading ? 3 : outcome?.ok ? 100 : 0;

  return (
    <div className="space-y-6">
      <PageHeader title="安装 eSIM" description="用运营商提供的激活码（LPA:1$…）下载 Profile。下载由读卡器通过自己的 Wi-Fi 直接与 SM-DP+ 完成。" />
      <RequireReady what="安装 eSIM">
        {!supported && (
          <Alert variant="warning">
            <CircleX />
            <AlertTitle>当前协议不支持下载</AlertTitle>
            <AlertDescription>
              下载需要读卡器固件代理 SM-DP+ 的 HTTPS 通信（浏览器无法跨域访问 SM-DP+）。只有旧版 eLPA 协议支持。
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <QrCode className="size-4" /> 激活码
              </CardTitle>
              <CardDescription>扫描或拖入运营商给的二维码，也可以直接粘贴激活码文字。识别在本机完成，激活码只保存在本页内存中，不会上传或写入日志。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div
                className={cn(
                  'flex flex-col items-center gap-3 rounded-lg border-2 border-dashed px-4 py-5 text-center transition-colors',
                  dragging ? 'border-primary bg-primary/5' : 'border-border',
                )}
                data-testid="qr-dropzone"
              >
                <div className="text-sm text-muted-foreground">
                  {decoding ? (
                    <span className="inline-flex items-center gap-2">
                      <LoaderCircle className="size-4 animate-spin" /> 正在识别二维码…
                    </span>
                  ) : dragging ? (
                    '松开鼠标即可识别二维码'
                  ) : (
                    <>把二维码图片拖到页面任意位置，或按 <kbd className="rounded border bg-muted px-1 font-mono text-xs">Ctrl</kbd>+<kbd className="rounded border bg-muted px-1 font-mono text-xs">V</kbd> 粘贴截图</>
                  )}
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setScanOpen(true)} disabled={locked || decoding}>
                    <Camera /> 摄像头扫描
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={locked || decoding}>
                    <ImageUp /> 选择图片
                  </Button>
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    aria-label="选择二维码图片"
                    data-testid="qr-file-input"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file) void decodeImage(file);
                    }}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ac" className="justify-between">
                  激活码
                  {fromQr && code && <Badge variant="secondary">来自二维码</Badge>}
                </Label>
                <Textarea
                  id="ac"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value);
                    setFromQr(false);
                  }}
                  placeholder="LPA:1$rsp.example.com$XXXX-XXXX-XXXX"
                  className="font-mono text-sm"
                  rows={2}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={downloading}
                  aria-invalid={!!parsed.error}
                />
                {parsed.error && <p className="text-sm text-destructive">{parsed.error}</p>}
              </div>

              {parsed.value && (
                <dl className="grid gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="flex items-center gap-1.5 text-muted-foreground">
                      <Server className="size-3.5" /> SM-DP+ 地址
                    </dt>
                    <dd className="font-mono break-all">{parsed.value.smdp}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">Matching ID</dt>
                    <dd className="font-mono">{parsed.value.matchingId ? maskId(parsed.value.matchingId, 2, 2) : <span className="text-muted-foreground">（空）</span>}</dd>
                  </div>
                  {parsed.value.oid && (
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">SM-DP+ OID</dt>
                      <dd className="font-mono">{parsed.value.oid}</dd>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">需要确认码</dt>
                    <dd>{parsed.value.confirmationCodeRequired ? <Badge variant="warning">是</Badge> : <Badge variant="muted">否</Badge>}</dd>
                  </div>
                </dl>
              )}

              {(parsed.value?.confirmationCodeRequired || confirmationCode) && (
                <div className="grid gap-2">
                  <Label htmlFor="cc" className="flex items-center gap-1.5">
                    <KeyRound className="size-3.5" /> 确认码（Confirmation Code）
                  </Label>
                  <Input id="cc" type="password" value={confirmationCode} onChange={(e) => setConfirmationCode(e.target.value)} autoComplete="one-time-code" disabled={downloading} aria-invalid={!!ccError} />
                  {ccError && <p className="text-sm text-destructive">{ccError}</p>}
                </div>
              )}

              <Button className="w-full" size="lg" onClick={() => setShowConfirm(true)} disabled={!canStart}>
                {downloading ? <LoaderCircle className="animate-spin" /> : <Download />}
                {downloading ? '正在下载并安装…' : '下载并安装'}
              </Button>
              {!wifiOk && supported && <p className="text-center text-xs text-warning-foreground dark:text-warning">读卡器未联网，无法下载。请先在右侧检查 Wi-Fi。</p>}
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">{wifiOk ? <Wifi className="size-4 text-success" /> : <WifiOff className="size-4 text-warning" />} 读卡器网络</CardTitle>
                <CardDescription>下载前必须确认读卡器已连接 2.4 GHz Wi-Fi。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">状态</span>
                  {wifi ? wifiOk ? <Badge variant="success">已联网</Badge> : <Badge variant="warning">未联网</Badge> : <span className="text-muted-foreground">未知</span>}
                </div>
                {wifi && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">网络 / 信号</span>
                    <span>
                      {wifi.ssid || '—'} · {rssiLabel(wifi.connected ? wifi.rssi : null)}
                    </span>
                  </div>
                )}
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => run('wifi', () => session.refreshWifi(), { success: (w) => (w.connected ? 'Wi-Fi 已连接' : 'Wi-Fi 未连接') })} disabled={!supported || op !== null}>
                    <RefreshCw /> 检查 Wi-Fi
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => navigate('settings')}>
                    配置 Wi-Fi
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>安装进度</CardTitle>
                <CardDescription>来自固件 download.c 的 progress 消息</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Progress value={pct} />
                <ol className="space-y-1.5 text-sm">
                  {STEP_ORDER.map((stage) => {
                    const current = progress?.stage === stage;
                    const done = stagesSeen.includes(stage) && !current;
                    const failed = outcome && !outcome.ok && !downloading && stagesSeen.at(-1) === stage;
                    return (
                      <li key={stage} className="flex items-center gap-2">
                        {failed ? (
                          <CircleX className="size-4 text-destructive" />
                        ) : current ? (
                          <LoaderCircle className="size-4 animate-spin text-primary" />
                        ) : done || outcome?.ok ? (
                          <CircleCheck className="size-4 text-success" />
                        ) : (
                          <span className="size-4 rounded-full border" />
                        )}
                        <span className={current ? 'font-medium' : done || outcome?.ok ? '' : 'text-muted-foreground'}>{DOWNLOAD_STAGES[stage]}</span>
                      </li>
                    );
                  })}
                </ol>
                {outcome?.ok && (
                  <Alert variant="success">
                    <CircleCheck />
                    <AlertTitle>安装成功</AlertTitle>
                    <AlertDescription>
                      新 Profile 默认处于停用状态。已自动刷新列表并读取待发送通知。
                      <Button variant="link" className="h-auto p-0" onClick={() => navigate('profiles')}>
                        前往 Profiles →
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}
                {outcome && !outcome.ok && (
                  <Alert variant="destructive">
                    <CircleX />
                    <AlertTitle>安装失败</AlertTitle>
                    <AlertDescription>{outcome.message}</AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="size-4" /> SM-DS 发现（可选）
            </CardTitle>
            <CardDescription>让读卡器向 GSMA 根 SM-DS（lpa.ds.gsma.com）查询是否有为此 EID 准备的 Profile。不会修改卡片。（待设备验证）</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button variant="outline" size="sm" onClick={() => run('discovery', () => session.discoverProfiles(), { success: (r) => `发现 ${r.length} 个 SM-DP+ 地址` })} disabled={!supported || !wifiOk || op !== null}>
              {op?.key === 'profile.discovery' ? <LoaderCircle className="animate-spin" /> : <Search />} 开始发现
            </Button>
            {discovery && (discovery.length ? <ul className="list-disc pl-5 font-mono text-sm">{discovery.map((d) => <li key={d}>{d}</li>)}</ul> : <p className="text-sm text-muted-foreground">没有发现待下载的 Profile。</p>)}
          </CardContent>
        </Card>

        <Alert variant="info">
          <ShieldCheck />
          <AlertTitle>安全说明</AlertTitle>
          <AlertDescription>
            <p>Profile 的真实性由 eUICC 校验 SM-DP+ 证书链（GSMA CI）保证，本应用不会跳过任何验证。</p>
            <p>下载命令使用 -s / -m / -c 分别传参，而不是把整串激活码交给固件：固件用 strtok 解析 “$”，遇到空字段会导致字段错位。</p>
          </AlertDescription>
        </Alert>
      </RequireReady>

      <QrScanDialog open={scanOpen} onOpenChange={setScanOpen} onResult={applyCode} />
      <ConfirmDialog
        open={showConfirm}
        onOpenChange={setShowConfirm}
        title="下载并安装 eSIM？"
        description={
          <>
            <p>
              读卡器将连接 <span className="font-mono text-foreground">{parsed.value?.smdp}</span> 下载 Profile 并写入 eUICC。
            </p>
            <p>大多数激活码只能使用一次。下载过程中请保持读卡器通电、靠近电脑，不要关闭页面或断开蓝牙。</p>
            <p>如果中途断开，结果未知：请重新连接后刷新 Profile 列表核对，不要直接重复下载。</p>
          </>
        }
        confirmLabel="开始下载"
        onConfirm={() => run('download', start, { success: '安装成功' })}
      />
    </div>
  );
}
