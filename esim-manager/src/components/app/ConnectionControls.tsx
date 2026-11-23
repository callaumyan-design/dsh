import { Bluetooth, BluetoothSearching, LoaderCircle, RefreshCw, Unplug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSession, useSessionController } from '@/hooks/session';
import { useAction } from './useAction';

/** 连接 / 重连 / 断开按钮组。设备选择器只能由用户点击打开。 */
export function ConnectionControls({ size = 'default', showAll = true }: { size?: 'default' | 'sm' | 'lg'; showAll?: boolean }) {
  const session = useSessionController();
  const state = useSession((s) => s.transport.state);
  const hasDevice = useSession((s) => s.transport.deviceName !== null || s.transport.deviceId !== null);
  const usable = useSession((s) => s.support.usable);
  const busyOp = useSession((s) => s.operation);
  const { pending, run } = useAction();

  const connecting = state === 'requesting' || state === 'connecting';

  if (state === 'connected') {
    return (
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size={size} onClick={() => run('disconnect', () => session.disconnect())} disabled={pending !== null}>
          <Unplug />
          断开连接
        </Button>
        {busyOp?.write && <span className="self-center text-xs text-warning-foreground dark:text-warning">写操作进行中，断开会导致结果未知</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button size={size} onClick={() => run('connect', () => session.connect('filtered'), { success: '已连接读卡器' })} disabled={!usable || connecting}>
        {connecting ? <LoaderCircle className="animate-spin" /> : <Bluetooth />}
        {state === 'requesting' ? '请在弹窗中选择设备…' : state === 'connecting' ? '正在连接…' : '连接读卡器'}
      </Button>
      {hasDevice && state === 'disconnected' && (
        <Button variant="secondary" size={size} onClick={() => run('reconnect', () => session.reconnect(), { success: '已重新连接' })} disabled={!usable || connecting}>
          <RefreshCw />
          重新连接
        </Button>
      )}
      {showAll && (
        <Button variant="ghost" size={size} onClick={() => run('connect-all', () => session.connect('all'), { success: '已连接' })} disabled={!usable || connecting}>
          <BluetoothSearching />
          显示所有设备
        </Button>
      )}
    </div>
  );
}
