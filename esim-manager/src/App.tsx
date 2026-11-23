import { useEffect } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppShell } from '@/components/layout/AppShell';
import { InterruptedBanner, MtuWarning, OperationBanner } from '@/components/app/StatusBanners';
import { SessionProvider } from '@/hooks/session';
import { useRoute } from '@/hooks/useRoute';
import { useTheme } from '@/hooks/theme';
import type { SessionController } from '@/lib/session/session';
import { DashboardPage } from '@/pages/DashboardPage';
import { DiagnosticsPage } from '@/pages/DiagnosticsPage';
import { InstallPage } from '@/pages/InstallPage';
import { ProfilesPage } from '@/pages/ProfilesPage';
import { SettingsPage } from '@/pages/SettingsPage';

/** 把文件拖到页面上时，浏览器默认会打开该文件、离开本页并断开蓝牙；这里统一阻止。 */
function usePreventFileDropNavigation() {
  useEffect(() => {
    const stop = (e: DragEvent) => {
      if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) e.preventDefault();
    };
    window.addEventListener('dragover', stop);
    window.addEventListener('drop', stop);
    return () => {
      window.removeEventListener('dragover', stop);
      window.removeEventListener('drop', stop);
    };
  }, []);
}

function Pages() {
  const [route, navigate] = useRoute();
  const { theme, setTheme } = useTheme();
  usePreventFileDropNavigation();
  return (
    <AppShell route={route} navigate={navigate} theme={theme} setTheme={setTheme}>
      <div className="mb-5 space-y-3 empty:hidden">
        <InterruptedBanner />
        <MtuWarning />
        <OperationBanner />
      </div>
      {route === 'dashboard' && <DashboardPage navigate={navigate} />}
      {route === 'profiles' && <ProfilesPage />}
      {route === 'install' && <InstallPage navigate={navigate} />}
      {route === 'settings' && <SettingsPage />}
      {route === 'diagnostics' && <DiagnosticsPage />}
    </AppShell>
  );
}

export default function App({ controller }: { controller?: SessionController }) {
  return (
    <SessionProvider controller={controller}>
      <TooltipProvider>
        <Pages />
        <Toaster position="top-center" richColors closeButton />
      </TooltipProvider>
    </SessionProvider>
  );
}
