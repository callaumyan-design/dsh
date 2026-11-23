import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Bug, FileDown, ListChecks, Play, Radio, ScrollText, Terminal, Trash2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CompatibilityNotice } from '@/components/app/CompatibilityNotice';
import { ConfirmDialog } from '@/components/app/ConfirmDialog';
import { KeyValue, PageHeader } from '@/components/app/PageHeader';
import { useAction } from '@/components/app/useAction';
import { useLogs, useSession, useSessionController } from '@/hooks/session';
import { FIRMWARE_TX_CHUNK_SIZE, MAX_COMMAND_BYTES, NUS_RX_UUID, NUS_SERVICE_UUID, NUS_TX_UUID } from '@/lib/ble/constants';
import type { CharacteristicSummary } from '@/lib/ble/transport';
import type { LogCategory, LogLevel } from '@/lib/log/logger';
import { LEGACY_COMMANDS } from '@/lib/protocol/legacy/commands';
import { redactJsonForLog } from '@/lib/protocol/redact';
import type { ProtocolMode } from '@/lib/session/session';
import { READ_ONLY_COMMANDS } from '@/lib/session/consoleCommands';
import { cn, formatBytes } from '@/lib/utils';

const yes = (v: boolean) => (v ? <Badge variant="success">是</Badge> : <Badge variant="destructive">否</Badge>);

function props(c: CharacteristicSummary | undefined) {
  if (!c) return '—';
  return [c.write && 'write', c.writeWithoutResponse && 'writeNR', c.notify && 'notify', c.indicate && 'indicate', c.read && 'read'].filter(Boolean).join(' · ') || '(无)';
}

function download(name: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ConnectionTab() {
  const session = useSessionController();
  const support = useSession((s) => s.support);
  const transport = useSession((s) => s.transport);
  const protocol = useSession((s) => s.protocol);
  const op = useSession((s) => s.operation);
  const { run } = useAction();
  const [probeConfirm, setProbeConfirm] = useState(false);
  const connected = transport.state === 'connected';

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>浏览器环境</CardTitle>
          <CardDescription>页面加载时只做检测，不发送任何蓝牙数据。</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="divide-y">
            <KeyValue label="navigator.bluetooth">{yes(support.apiPresent)}</KeyValue>
            <KeyValue label="安全上下文" hint={`${support.protocol}//${support.hostname}`}>
              {yes(support.secureContext)}
            </KeyValue>
            <KeyValue label="蓝牙适配器">{support.availability === 'available' ? <Badge variant="success">可用</Badge> : support.availability === 'unavailable' ? <Badge variant="destructive">不可用</Badge> : <Badge variant="muted">未知</Badge>}</KeyValue>
            <KeyValue label="平台">
              {[support.platform.isWindows && 'Windows', support.platform.isMac && 'macOS', support.platform.isLinux && 'Linux', support.platform.isChromeOS && 'ChromeOS', support.platform.isAndroid && 'Android', support.platform.isIOS && 'iOS'].filter(Boolean).join(' / ') || '未知'}
              {' · '}
              {support.platform.isChromium ? 'Chromium' : support.platform.isFirefox ? 'Firefox' : support.platform.isSafari ? 'Safari' : '其他'}
            </KeyValue>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>GATT</CardTitle>
          <CardDescription>服务 {NUS_SERVICE_UUID}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="divide-y">
            <KeyValue label="连接状态">{transport.state}</KeyValue>
            <KeyValue label="设备名称">{transport.deviceName ?? '—'}</KeyValue>
            <KeyValue label="UART 服务">{transport.gatt ? yes(true) : '—'}</KeyValue>
            <KeyValue label="RX 特征" hint={NUS_RX_UUID.slice(0, 8)}>
              {props(transport.gatt?.rx)}
            </KeyValue>
            <KeyValue label="TX 特征" hint={NUS_TX_UUID.slice(0, 8)}>
              {props(transport.gatt?.tx)}
            </KeyValue>
            <KeyValue label="通知已订阅">{transport.gatt ? yes(transport.gatt.notifying) : '—'}</KeyValue>
            {transport.lastError && <KeyValue label="最近错误">{transport.lastError}</KeyValue>}
          </dl>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>协议模式</CardTitle>
          <CardDescription>自动识别只发送官方源码中确认为只读的 getElpaInfo；APDU JSON 协议不会被自动尝试。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Select value={protocol.mode} onValueChange={(v) => run('mode', async () => session.setProtocolMode(v as ProtocolMode), { silentSuccess: true })}>
              <SelectTrigger className="w-72" aria-label="协议模式">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">自动识别（推荐）</SelectItem>
                <SelectItem value="legacy-elpa">旧版 eLPA：JSON 控制 + lpac CLI</SelectItem>
                <SelectItem value="apdu-json">APDU JSON（NekokoLPA 风格，待设备验证）</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" disabled={!connected || op !== null} onClick={() => run('identify', () => session.identify(), { success: (ok) => (ok ? '已识别为旧版 eLPA 协议' : '未能识别') })}>
              <ListChecks /> 识别协议
            </Button>
            <Button variant="ghost" disabled={!connected || op !== null} onClick={() => setProbeConfirm(true)}>
              <Radio /> 探测 APDU JSON 协议
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">当前：</span>
            {protocol.active ? <Badge>{protocol.active === 'legacy-elpa' ? '旧版 eLPA' : 'APDU JSON'}</Badge> : <Badge variant="muted">未确定</Badge>}
            <Badge variant="outline">{protocol.status}</Badge>
            {protocol.detail && <span className="text-muted-foreground">{protocol.detail}</span>}
          </div>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={probeConfirm}
        onOpenChange={setProbeConfirm}
        title="发送 APDU JSON 探测命令？"
        description={
          <>
            <p>
              将发送 <code className="font-mono">{'{"cmd":"APDU","action":2}'}</code>（关闭 APDU 通道）。
            </p>
            <p>官方 eLPA 2.x 固件不认识该命令，会静默忽略（源码中没有对应处理函数），不会修改卡片。若设备回复，则切换到 APDU JSON 只读模式。</p>
          </>
        }
        confirmLabel="发送探测"
        onConfirm={() => run('probe', () => session.probeApduProtocol(), { success: (ok) => (ok ? '设备支持 APDU JSON 协议' : '设备没有回复：不支持 APDU JSON 协议') })}
      />
    </div>
  );
}

function StatsTab() {
  const session = useSessionController();
  const stats = useSession((s) => s.stats);
  const max = Math.max(FIRMWARE_TX_CHUNK_SIZE, ...stats.recentChunks);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
      <Card>
        <CardHeader>
          <CardTitle>通信统计</CardTitle>
          <CardAction>
            <Button variant="ghost" size="sm" onClick={() => session.resetStats()}>
              重置
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <dl className="divide-y">
            <KeyValue label="收到通知">{stats.notifications}</KeyValue>
            <KeyValue label="收到字节">{formatBytes(stats.bytes)}</KeyValue>
            <KeyValue label="分片大小（最小 / 最大）" hint={`固件每段 ${FIRMWARE_TX_CHUNK_SIZE} 字节`}>
              {stats.minChunk ?? '—'} / {stats.maxChunk ?? '—'}
            </KeyValue>
            <KeyValue label="解析出的消息">{stats.messages}</KeyValue>
            <KeyValue label="无法解析的 JSON">{stats.invalid}</KeyValue>
            <KeyValue label="不完整（丢弃）">{stats.truncated > 0 ? <Badge variant="warning">{stats.truncated}</Badge> : 0}</KeyValue>
            <KeyValue label="未匹配的消息" hint="主动推送或迟到的回复">
              {stats.strays}
            </KeyValue>
            <KeyValue label="超时">{stats.timeouts}</KeyValue>
            <KeyValue label="写入次数 / 字节">
              {stats.writes} / {formatBytes(stats.writeBytes)}
            </KeyValue>
            <KeyValue label="最长单次写入" hint={`上限 ${MAX_COMMAND_BYTES} 字节`}>
              {stats.maxWrite}
            </KeyValue>
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>最近 40 个通知分片</CardTitle>
          <CardDescription>
            长消息中除最后一片外都应恰好是 {FIRMWARE_TX_CHUNK_SIZE} 字节。若最大值始终小于 {FIRMWARE_TX_CHUNK_SIZE}，说明系统协商的 MTU 偏小，长回复会被截断。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {stats.recentChunks.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无数据。</p>
          ) : (
            <div className="flex h-32 items-end gap-[3px]" role="img" aria-label={`分片大小：${stats.recentChunks.join(', ')}`}>
              {stats.recentChunks.map((n, i) => (
                <div
                  key={i}
                  title={`${n} 字节`}
                  className={cn('min-w-[4px] flex-1 rounded-t-sm', n === FIRMWARE_TX_CHUNK_SIZE ? 'bg-primary' : 'bg-primary/45')}
                  style={{ height: `${Math.max(4, (n / max) * 100)}%` }}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ConsoleTab() {
  const session = useSessionController();
  const connected = useSession((s) => s.transport.state === 'connected');
  const op = useSession((s) => s.operation);
  const { run } = useAction();
  const [text, setText] = useState('');
  const [result, setResult] = useState<string | null>(null);

  const exec = async (cmd: string) => {
    setResult(null);
    const r = await run('console', () => session.runReadOnlyCommand(cmd), { silentSuccess: true });
    if (r !== undefined) setResult(JSON.stringify(JSON.parse(redactJsonForLog(r)), null, 2));
  };

  return (
    <div className="space-y-4">
      <Alert variant="info">
        <Terminal />
        <AlertTitle>只读控制台</AlertTitle>
        <AlertDescription>只接受白名单中的只读命令。启用、停用、删除、下载、purge、OTA 等命令会被拒绝，必须走带确认的页面流程。结果已脱敏。</AlertDescription>
      </Alert>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {READ_ONLY_COMMANDS.map((c) => (
          <button
            key={c.id}
            type="button"
            disabled={!connected || op !== null}
            onClick={() => exec(c.id)}
            className="flex flex-col items-start gap-1 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
          >
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <Play className="size-3.5 text-primary" /> {c.label}
            </span>
            <code className="font-mono text-xs text-muted-foreground">{c.text}</code>
            {c.note && <span className="text-[11px] text-muted-foreground">{c.note}</span>}
          </button>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) void exec(text);
        }}
      >
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="lpac chip info" className="font-mono" aria-label="命令" spellCheck={false} autoComplete="off" />
        <Button type="submit" disabled={!connected || op !== null || !text.trim()}>
          执行
        </Button>
      </form>
      {result && <pre className="max-h-96 overflow-auto rounded-lg border bg-muted/50 p-3 font-mono text-xs leading-relaxed">{result}</pre>}
    </div>
  );
}

const LEVELS: Record<LogLevel, string> = { debug: 'text-muted-foreground', info: 'text-foreground', warn: 'text-warning-foreground dark:text-warning', error: 'text-destructive' };
const CATS: Array<LogCategory | 'all'> = ['all', 'tx', 'rx', 'ble', 'protocol', 'app', 'env'];

function LogsTab() {
  const session = useSessionController();
  const logs = useLogs();
  const support = useSession((s) => s.support);
  const transport = useSession((s) => s.transport);
  const deviceInfo = useSession((s) => s.device.info);
  const [cat, setCat] = useState<LogCategory | 'all'>('all');
  const [showDebug, setShowDebug] = useState(false);
  const [q, setQ] = useState('');
  const [follow, setFollow] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () => logs.filter((l) => (cat === 'all' || l.category === cat) && (showDebug || l.level !== 'debug') && (!q || `${l.message} ${l.detail ?? ''}`.toLowerCase().includes(q.toLowerCase()))),
    [logs, cat, showDebug, q],
  );

  useEffect(() => {
    if (follow && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [filtered, follow]);

  const header = () => ({
    app: '9eSIM Web Manager',
    exportedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    secureContext: String(support.secureContext),
    device: transport.deviceName ?? '-',
    firmware: deviceInfo?.software ?? '-',
    note: '日志已脱敏：Wi-Fi 密码、激活码、确认码完全隐藏；EID / ICCID 仅保留前后 4 位。',
  });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  return (
    <Card>
      <CardHeader>
        <CardTitle>通信日志</CardTitle>
        <CardDescription>仅保存在内存中（最多 3000 条），写入前已脱敏。为避免泄露跨分片的敏感字段，原始通知分片只记录长度。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={cat} onValueChange={(v) => setCat(v as LogCategory | 'all')}>
            <SelectTrigger className="w-32" aria-label="分类">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATS.map((c) => (
                <SelectItem key={c} value={c}>
                  {c === 'all' ? '全部分类' : c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索…" className="w-40" />
          <div className="flex items-center gap-2 text-sm">
            <Switch id="dbg" checked={showDebug} onCheckedChange={setShowDebug} />
            <Label htmlFor="dbg">调试</Label>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Switch id="follow" checked={follow} onCheckedChange={setFollow} />
            <Label htmlFor="follow">自动滚动</Label>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => download(`9esim-log-${stamp}.txt`, session.logger.exportText(header()), 'text/plain')}>
              <FileDown /> 导出 TXT
            </Button>
            <Button variant="outline" size="sm" onClick={() => download(`9esim-log-${stamp}.json`, session.logger.exportJson(header()), 'application/json')}>
              <FileDown /> 导出 JSON
            </Button>
            <Button variant="ghost" size="sm" onClick={() => session.logger.clear()}>
              <Trash2 /> 清空
            </Button>
          </div>
        </div>
        <div ref={ref} className="h-[28rem] overflow-auto rounded-lg border bg-muted/30 p-2 font-mono text-xs leading-relaxed" data-testid="log-view">
          {filtered.length === 0 ? (
            <p className="p-2 text-muted-foreground">暂无日志。</p>
          ) : (
            filtered.map((l) => (
              <div key={l.id} className={cn('border-b border-border/40 px-1 py-1 last:border-0', LEVELS[l.level])}>
                <span className="text-muted-foreground">{new Date(l.ts).toLocaleTimeString()}</span> <span className="uppercase opacity-70">[{l.category}]</span> {l.message}
                {l.detail && <div className="mt-0.5 break-all whitespace-pre-wrap text-muted-foreground">{l.detail}</div>}
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ErrorsTab() {
  const session = useSessionController();
  const errors = useSession((s) => s.errors);
  return (
    <Card>
      <CardHeader>
        <CardTitle>错误追踪</CardTitle>
        <CardDescription>最近 50 个失败的操作（已脱敏）。</CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm" onClick={() => session.clearErrors()} disabled={errors.length === 0}>
            清空
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {errors.length === 0 ? (
          <p className="text-sm text-muted-foreground">没有错误。</p>
        ) : (
          <ul className="divide-y">
            {[...errors].reverse().map((e) => (
              <li key={e.id} className="py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="destructive">{e.context}</Badge>
                  <code className="text-xs text-muted-foreground">{e.name}</code>
                  <span className="ml-auto text-xs text-muted-foreground">{new Date(e.at).toLocaleTimeString()}</span>
                </div>
                <p className="mt-1">{e.message}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ReferenceTab() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>旧版 eLPA 协议命令表</CardTitle>
        <CardDescription>每条命令都对应 9esim/eLPA 固件源码中的实现（提交 e0bd5dc）。状态：已按源码核对，待真实设备验证。</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="py-2 pr-3 font-medium">命令</th>
              <th className="py-2 pr-3 font-medium">类型</th>
              <th className="py-2 pr-3 font-medium">只读</th>
              <th className="py-2 pr-3 font-medium">成功标识</th>
              <th className="py-2 font-medium">源码</th>
            </tr>
          </thead>
          <tbody>
            {Object.values(LEGACY_COMMANDS).map((c) => (
              <tr key={c.id} className="border-b last:border-0">
                <td className="py-2 pr-3">{c.label}</td>
                <td className="py-2 pr-3">
                  <Badge variant="outline">{c.kind === 'json' ? 'JSON' : 'CLI'}</Badge>
                </td>
                <td className="py-2 pr-3">{c.readOnly ? <Badge variant="success">只读</Badge> : <Badge variant="warning">写入</Badge>}</td>
                <td className="py-2 pr-3 font-mono text-xs">{'successDataType' in c ? c.successDataType : 'responseCmd' in c ? (c.responseCmd ?? '（不回复）') : ''}</td>
                <td className="py-2 font-mono text-xs text-muted-foreground">{c.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export function DiagnosticsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="诊断" description="连接细节、协议识别、通信统计、只读测试指令与日志。调试功能不会自动发送任何修改卡片状态的命令。" />
      <CompatibilityNotice compact />
      <Tabs defaultValue="connection">
        <TabsList className="flex h-auto w-full flex-wrap justify-start sm:w-fit">
          <TabsTrigger value="connection">
            <Radio /> 连接与协议
          </TabsTrigger>
          <TabsTrigger value="stats">
            <Activity /> 统计
          </TabsTrigger>
          <TabsTrigger value="console">
            <Terminal /> 只读指令
          </TabsTrigger>
          <TabsTrigger value="logs">
            <ScrollText /> 日志
          </TabsTrigger>
          <TabsTrigger value="errors">
            <Bug /> 错误
          </TabsTrigger>
          <TabsTrigger value="reference">
            <ListChecks /> 命令表
          </TabsTrigger>
        </TabsList>
        <TabsContent value="connection">
          <ConnectionTab />
        </TabsContent>
        <TabsContent value="stats">
          <StatsTab />
        </TabsContent>
        <TabsContent value="console">
          <ConsoleTab />
        </TabsContent>
        <TabsContent value="logs">
          <LogsTab />
        </TabsContent>
        <TabsContent value="errors">
          <ErrorsTab />
        </TabsContent>
        <TabsContent value="reference">
          <ReferenceTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
