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

function Pages() {
  const [route, navigate] = useRoute();
  const { theme, setTheme } = useTheme();
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
