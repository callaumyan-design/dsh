import { LoaderCircle, TriangleAlert, X } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useSession, useSessionController } from '@/hooks/session';
import { FIRMWARE_TX_CHUNK_SIZE } from '@/lib/ble/constants';

/** 正在执行的操作（全局）。 */
export function OperationBanner() {
  const op = useSession((s) => s.operation);
  if (!op) return null;
  const pct = op.progress?.step && op.progress.totalSteps ? Math.round((op.progress.step / op.progress.totalSteps) * 100) : null;
  return (
    <div className="rounded-lg border bg-card px-4 py-3 shadow-xs" role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-sm font-medium">
        <LoaderCircle className="size-4 animate-spin text-primary" />
        <span>{op.label}</span>
        {op.write && <span className="rounded bg-warning/20 px-1.5 py-0.5 text-[11px] text-warning-foreground dark:text-warning">写操作 · 请勿断开</span>}
        {op.progress?.step != null && (
          <span className="ml-auto text-xs text-muted-foreground tabular">
            {op.progress.step}/{op.progress.totalSteps ?? '?'}
          </span>
        )}
      </div>
      {op.progress && <p className="mt-1 text-xs text-muted-foreground">{op.progress.label}</p>}
      <Progress className="mt-2 h-1.5" value={pct ?? undefined} indeterminate={pct === null} />
    </div>
  );
}

/** 写操作中断提示：结果未知，不会自动重试。 */
export function InterruptedBanner() {
  const session = useSessionController();
  const interrupted = useSession((s) => s.interrupted);
  if (!interrupted) return null;
  return (
    <Alert variant="warning">
      <TriangleAlert />
      <AlertTitle className="flex items-center justify-between gap-2">
        「{interrupted.label}」在完成前蓝牙断开
        <Button variant="ghost" size="icon-sm" className="-my-1 size-6" onClick={() => session.dismissInterrupted()} aria-label="关闭提示">
          <X className="size-3.5" />
        </Button>
      </AlertTitle>
      <AlertDescription>操作结果未知，本应用不会自动重试或恢复。请重新连接后刷新 Profile 列表，核对卡上的实际状态再决定下一步。</AlertDescription>
    </Alert>
  );
}

/** 检测到通知被截断（通常是 MTU 太小）。 */
export function MtuWarning() {
  const truncated = useSession((s) => s.stats.truncated);
  const maxChunk = useSession((s) => s.stats.maxChunk);
  if (truncated === 0 || maxChunk === null || maxChunk >= FIRMWARE_TX_CHUNK_SIZE) return null;
  return (
    <Alert variant="warning">
      <TriangleAlert />
      <AlertTitle>BLE 通知可能被截断</AlertTitle>
      <AlertDescription>
        <p>
          固件每次通知发送 {FIRMWARE_TX_CHUNK_SIZE} 字节，但浏览器收到的最大分片只有 {maxChunk} 字节，已有 {truncated} 条消息因不完整被丢弃。
          这通常表示系统协商的 ATT MTU 小于 {FIRMWARE_TX_CHUNK_SIZE + 3}，网页无法修改 MTU。
        </p>
        <p>可以尝试：换用其他电脑或系统（Windows / Android 版 Chrome 通常协商较大 MTU）、断开后重新连接、重启电脑蓝牙。</p>
      </AlertDescription>
    </Alert>
  );
}
