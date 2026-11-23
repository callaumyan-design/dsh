import type { ReactNode } from 'react';
import { Bluetooth, BluetoothConnected, BluetoothOff, CardSim, Download, LayoutDashboard, LoaderCircle, Monitor, Moon, Settings, Stethoscope, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSession } from '@/hooks/session';
import type { Route } from '@/hooks/useRoute';
import type { Theme } from '@/hooks/theme';
import { cn } from '@/lib/utils';

const NAV: Array<{ route: Route; label: string; short: string; icon: typeof LayoutDashboard }> = [
  { route: 'dashboard', label: '仪表盘', short: '概览', icon: LayoutDashboard },
  { route: 'profiles', label: 'eSIM Profiles', short: 'Profiles', icon: CardSim },
  { route: 'install', label: '安装 eSIM', short: '安装', icon: Download },
  { route: 'settings', label: '设备设置', short: '设备', icon: Settings },
  { route: 'diagnostics', label: '诊断', short: '诊断', icon: Stethoscope },
];

export function ConnectionPill() {
  const state = useSession((s) => s.transport.state);
  const name = useSession((s) => s.transport.deviceName);
  const protocol = useSession((s) => s.protocol);
  const map = {
    idle: { label: '未连接', icon: BluetoothOff, cls: 'bg-muted text-muted-foreground' },
    disconnected: { label: '已断开', icon: BluetoothOff, cls: 'bg-muted text-muted-foreground' },
    requesting: { label: '选择设备…', icon: LoaderCircle, cls: 'bg-accent text-accent-foreground' },
    connecting: { label: '连接中…', icon: LoaderCircle, cls: 'bg-accent text-accent-foreground' },
    disconnecting: { label: '断开中…', icon: LoaderCircle, cls: 'bg-muted text-muted-foreground' },
    connected: { label: name ?? '已连接', icon: BluetoothConnected, cls: 'bg-success/15 text-success' },
  } as const;
  const m = map[state];
  const Icon = m.icon;
  const spinning = state === 'requesting' || state === 'connecting' || state === 'disconnecting';
  return (
    <div className={cn('inline-flex max-w-[16rem] items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', m.cls)} data-testid="connection-pill" data-state={state}>
      <Icon className={cn('size-3.5 shrink-0', spinning && 'animate-spin')} />
      <span className="truncate">{m.label}</span>
      {state === 'connected' && protocol.status === 'probing' && <span className="text-muted-foreground">· 识别中</span>}
      {state === 'connected' && protocol.active === 'apdu-json' && <span className="opacity-80">· APDU</span>}
      {state === 'connected' && protocol.status === 'unidentified' && <span className="text-warning-foreground dark:text-warning">· 协议未知</span>}
    </div>
  );
}

function ThemeToggle({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
  const next: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;
  const label = theme === 'light' ? '浅色' : theme === 'dark' ? '深色' : '跟随系统';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" onClick={() => setTheme(next[theme])} aria-label={`主题：${label}`}>
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>主题：{label}</TooltipContent>
    </Tooltip>
  );
}

export function AppShell({ route, navigate, theme, setTheme, children }: { route: Route; navigate: (r: Route) => void; theme: Theme; setTheme: (t: Theme) => void; children: ReactNode }) {
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      {/* 桌面侧边栏 */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex items-center gap-2.5 px-5 pt-5 pb-6">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <CardSim className="size-5" />
          </div>
          <div className="leading-tight">
            <div className="font-semibold">9eSIM Manager</div>
            <div className="text-[11px] text-muted-foreground">Web Bluetooth eLPA</div>
          </div>
        </div>
        <nav className="flex flex-col gap-0.5 px-3" aria-label="主导航">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = route === item.route;
            return (
              <a
                key={item.route}
                href={`#/${item.route}`}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(item.route);
                }}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  active ? 'bg-primary/10 text-primary' : 'text-sidebar-foreground/80 hover:bg-accent hover:text-accent-foreground',
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </a>
            );
          })}
        </nav>
        <div className="mt-auto space-y-3 px-5 pb-5">
          <ConnectionPill />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            所有通信都在浏览器与读卡器之间直接进行，不经过任何服务器。
          </p>
          <ThemeToggle theme={theme} setTheme={setTheme} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        {/* 移动端顶栏 */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b bg-background/85 px-4 py-2.5 backdrop-blur md:hidden">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Bluetooth className="size-4" />
          </div>
          <div className="min-w-0 flex-1 font-semibold">9eSIM Manager</div>
          <ConnectionPill />
          <ThemeToggle theme={theme} setTheme={setTheme} />
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-5 pb-28 sm:px-6 md:pt-8 md:pb-10">{children}</main>

        {/* 移动端底部导航 */}
        <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="主导航">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = route === item.route;
            return (
              <a
                key={item.route}
                href={`#/${item.route}`}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(item.route);
                }}
                aria-current={active ? 'page' : undefined}
                className={cn('flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium', active ? 'text-primary' : 'text-muted-foreground')}
              >
                <Icon className="size-5" />
                {item.short}
              </a>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
