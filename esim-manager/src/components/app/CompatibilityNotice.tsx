import { MonitorX, ShieldAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useSession } from '@/hooks/session';

/** 浏览器不支持或不在安全上下文时，明确告知用户，绝不显示“已连接”。 */
export function CompatibilityNotice({ compact = false }: { compact?: boolean }) {
  const support = useSession((s) => s.support);
  if (support.problems.length === 0) return null;
  const blocking = !support.usable;
  return (
    <Alert variant={blocking ? 'destructive' : 'warning'}>
      {blocking ? <MonitorX /> : <ShieldAlert />}
      <AlertTitle>{blocking ? '此浏览器无法使用 Web Bluetooth' : '蓝牙环境提示'}</AlertTitle>
      <AlertDescription>
        <ul className="list-disc space-y-1 pl-4">
          {support.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        {!compact && support.hints.length > 0 && (
          <ul className="mt-1 space-y-1 text-foreground/80">
            {support.hints.map((h) => (
              <li key={h}>→ {h}</li>
            ))}
          </ul>
        )}
      </AlertDescription>
    </Alert>
  );
}
