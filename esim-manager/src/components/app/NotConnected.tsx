import { BluetoothOff, HelpCircle } from 'lucide-react';
import { useReady, useSession } from '@/hooks/session';
import { ConnectionControls } from './ConnectionControls';
import { EmptyState } from './PageHeader';

/** 未连接 / 协议未识别时的占位。 */
export function RequireReady({ children, what }: { children: React.ReactNode; what: string }) {
  const { connected, ready } = useReady();
  const status = useSession((s) => s.protocol.status);
  const detail = useSession((s) => s.protocol.detail);
  if (!connected) {
    return (
      <EmptyState icon={<BluetoothOff />} title="尚未连接读卡器">
        <p className="mb-4">连接 9eSIM 读卡器（eSIM_Writer）后才能{what}。</p>
        <div className="flex justify-center">
          <ConnectionControls showAll={false} />
        </div>
      </EmptyState>
    );
  }
  if (!ready) {
    return (
      <EmptyState icon={<HelpCircle />} title={status === 'probing' ? '正在识别通信协议…' : '尚未确定通信协议'}>
        {detail ?? '请前往“诊断”页面识别或手动选择协议。'}
      </EmptyState>
    );
  }
  return <>{children}</>;
}
