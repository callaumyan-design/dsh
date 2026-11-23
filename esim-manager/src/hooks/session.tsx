import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { SessionController, type SessionState } from '@/lib/session/session';
import type { LogEntry } from '@/lib/log/logger';

const SessionContext = createContext<SessionController | null>(null);

export function SessionProvider({ children, controller }: { children: ReactNode; controller?: SessionController }) {
  const session = useMemo(() => controller ?? new SessionController(), [controller]);
  useEffect(() => {
    // 只检测环境，不发送任何蓝牙数据
    void session.refreshSupport();
  }, [session]);
  useEffect(() => {
    const onUnload = () => {
      void session.disconnect();
    };
    window.addEventListener('pagehide', onUnload);
    return () => window.removeEventListener('pagehide', onUnload);
  }, [session]);
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSessionController(): SessionController {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSessionController must be used inside <SessionProvider>');
  return s;
}

/** 订阅会话状态。selector 应返回状态树中已有的引用（避免每次新建对象）。 */
export function useSession<T>(selector: (s: SessionState) => T): T {
  const session = useSessionController();
  return useSyncExternalStore(session.subscribe, () => selector(session.getSnapshot()));
}

export function useLogs(): readonly LogEntry[] {
  const session = useSessionController();
  return useSyncExternalStore(session.logger.subscribe, session.logger.getSnapshot);
}

/** 是否已连接且协议可用。 */
export function useReady() {
  const connected = useSession((s) => s.transport.state === 'connected');
  const active = useSession((s) => s.protocol.active);
  return { connected, protocol: active, ready: connected && active !== null };
}
