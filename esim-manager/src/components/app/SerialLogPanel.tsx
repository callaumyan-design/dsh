import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { FileDown, PlugZap, TriangleAlert, Trash2, Unplug, Usb } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useAction } from '@/components/app/useAction';
import { describeSw, serialLog, type SerialLineKind } from '@/lib/serial/serialLog';
import { cn } from '@/lib/utils';

const KIND_CLS: Record<SerialLineKind, string> = {
  'apdu-tx': 'text-primary',
  'apdu-rx': 'text-foreground',
  error: 'text-destructive',
  http: 'text-muted-foreground',
  info: 'text-muted-foreground',
};

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 诊断页：读卡器 USB 串口调试日志。 */
export function SerialLogPanel() {
  const ctl = serialLog();
  const snap = useSyncExternalStore(ctl.subscribe, ctl.getSnapshot);
  const { run } = useAction();
  const [onlyImportant, setOnlyImportant] = useState(true);
  const [q, setQ] = useState('');
  const [follow, setFollow] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  const lines = useMemo(
    () => snap.lines.filter((l) => (!onlyImportant || l.kind !== 'info') && (!q || l.text.toLowerCase().includes(q.toLowerCase()))),
    [snap.lines, onlyImportant, q],
  );

  useEffect(() => {
    if (follow && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines, follow]);

  if (!snap.supported) {
    return (
      <Alert variant="warning">
        <TriangleAlert />
        <AlertTitle>此浏览器不支持 Web Serial</AlertTitle>
        <AlertDescription>请使用桌面版 Chrome / Edge（89+）。Android 和 iOS 浏览器不支持读取 USB 串口。</AlertDescription>
      </Alert>
    );
  }

  const connected = snap.state === 'connected';

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Usb className="size-4" /> 读卡器 USB 串口日志
          </CardTitle>
          <CardDescription>
            官方固件会通过 USB 串口（115200 波特率）输出调试日志，其中有读卡器发给卡片的每一条 APDU 和卡片回复的状态字。排查“写入 eUICC 失败”这类问题时，这是唯一能看到卡片真实回复的地方。（待设备验证）
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>用 USB-C 数据线把读卡器接到电脑。Windows 上应出现 “USB-SERIAL CH340” 之类的 COM 口；没有的话需要安装 CH340 驱动，或把 USB-C 插头翻转 180° 再插（官方说明）。</li>
            <li>
              <span className="text-foreground">先</span>点“连接串口”。打开串口时读卡器可能会重启，所以要在连接蓝牙<span className="text-foreground">之前</span>做这一步。
            </li>
            <li>再连接蓝牙，执行要排查的操作（例如下载 eSIM）。</li>
            <li>导出日志。日志已脱敏：APDU 只保留指令头和状态字，密码、激活码参数、EID 都已隐藏。</li>
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            {connected ? (
              <Button variant="outline" onClick={() => run('serial-off', () => ctl.disconnect(), { silentSuccess: true })}>
                <Unplug /> 断开串口
              </Button>
            ) : (
              <>
                <Button onClick={() => run('serial', () => ctl.connect(false), { success: '已连接串口' })} disabled={snap.state === 'connecting'}>
                  <PlugZap /> 连接串口
                </Button>
                <Button variant="ghost" onClick={() => run('serial-all', () => ctl.connect(true), { success: '已连接串口' })} disabled={snap.state === 'connecting'}>
                  显示所有串口
                </Button>
              </>
            )}
            <span className="text-sm text-muted-foreground">
              {connected ? `已连接：${snap.portLabel}` : snap.state === 'connecting' ? '请在弹窗中选择串口…' : '未连接'}
            </span>
          </div>
          {snap.error && (
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertDescription>{snap.error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {(snap.abnormalCount > 0 || snap.transportFailures > 0) && (
        <Alert variant="warning" data-testid="serial-summary">
          <TriangleAlert />
          <AlertTitle>发现异常</AlertTitle>
          <AlertDescription>
            {snap.abnormalCount > 0 && snap.lastAbnormal?.sw && (
              <p>
                卡片返回非成功状态字 {snap.abnormalCount} 次，最后一次：
                <code className="mx-1 font-mono">{snap.lastAbnormal.sw}</code>（{describeSw(snap.lastAbnormal.sw)}）
              </p>
            )}
            {snap.transportFailures > 0 && <p>读卡器与卡片之间传输失败 {snap.transportFailures} 次（Failed to receive data / Failed to exchange APDU）。</p>}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>日志</CardTitle>
          <CardDescription>{snap.lines.length} 行（内存中最多保留 5000 行）</CardDescription>
          <CardAction className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={snap.lines.length === 0}
              onClick={() => download(`9esim-serial-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`, ctl.exportText({ app: '9eSIM Web Manager', source: 'USB serial 115200', exportedAt: new Date().toISOString(), note: '已脱敏：APDU 只保留前 8 字节与状态字；密码、激活码参数、EID 已隐藏' }))}
            >
              <FileDown /> 导出
            </Button>
            <Button variant="ghost" size="sm" onClick={() => ctl.clear()} disabled={snap.lines.length === 0}>
              <Trash2 /> 清空
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索…" className="w-44" />
            <div className="flex items-center gap-2 text-sm">
              <Switch id="serial-important" checked={onlyImportant} onCheckedChange={setOnlyImportant} />
              <Label htmlFor="serial-important">只看 APDU / 错误 / HTTP</Label>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Switch id="serial-follow" checked={follow} onCheckedChange={setFollow} />
              <Label htmlFor="serial-follow">自动滚动</Label>
            </div>
          </div>
          <div ref={ref} className="h-[28rem] overflow-auto rounded-lg border bg-muted/30 p-2 font-mono text-xs leading-relaxed" data-testid="serial-view">
            {lines.length === 0 ? (
              <p className="p-2 text-muted-foreground">{connected ? '等待读卡器输出…' : '尚未连接串口。'}</p>
            ) : (
              lines.map((l) => (
                <div key={l.id} className={cn('border-b border-border/40 px-1 py-0.5 break-all last:border-0', KIND_CLS[l.kind], l.abnormal && 'bg-destructive/10')}>
                  {l.text}
                  {l.sw && l.abnormal && (
                    <Badge variant="destructive" className="ml-2">
                      {l.sw} {describeSw(l.sw)}
                    </Badge>
                  )}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
