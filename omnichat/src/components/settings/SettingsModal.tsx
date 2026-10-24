import { BarChart3, BookOpen, Boxes, Cpu, Database, Info, Palette, Shield, UserRound, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { IconButton, useEscape } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { useAuth } from '@/store/auth';
import { useUI, type SettingsTab } from '@/store/ui';
import { useT } from '@/i18n';
import { ProvidersTab } from './ProvidersTab';
import { GeneralTab, ModelsTab } from './GeneralTabs';
import { PromptsTab } from './PromptsTab';
import { DataTab } from './DataTab';
import { UsageTab } from './UsageTab';
import { AboutTab, AccountTab, AdminTab } from './AccountTabs';

export function SettingsModal() {
  const t = useT();
  const open = useUI((s) => s.settingsOpen);
  const tab = useUI((s) => s.settingsTab);
  const isAdmin = useAuth((s) => !!s.user?.isAdmin);
  const close = () => useUI.setState({ settingsOpen: false });

  useEscape(open, close);

  if (!open) return null;

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: 'providers', label: t('settings.providers'), icon: <Boxes /> },
    { id: 'models', label: t('settings.models'), icon: <Cpu /> },
    { id: 'general', label: t('settings.general'), icon: <Palette /> },
    { id: 'prompts', label: t('settings.prompts'), icon: <BookOpen /> },
    { id: 'usage', label: t('settings.usage'), icon: <BarChart3 /> },
    { id: 'data', label: t('settings.data'), icon: <Database /> },
    { id: 'account', label: t('settings.account'), icon: <UserRound /> },
    ...(isAdmin ? [{ id: 'admin' as const, label: t('settings.admin'), icon: <Shield /> }] : []),
    { id: 'about', label: t('settings.about'), icon: <Info /> },
  ];
  const active = tabs.find((x) => x.id === tab) ?? tabs[0];

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center sm:p-4">
      <div className="anim-fade absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={close} />
      <div
        role="dialog"
        aria-modal="true"
        className="anim-up relative flex h-[100dvh] w-full flex-col overflow-hidden bg-elevated shadow-pop sm:h-[min(760px,92dvh)] sm:max-w-5xl sm:flex-row sm:rounded-2xl sm:border sm:border-line"
      >
        <div className="safe-top flex shrink-0 flex-col border-line sm:w-52 sm:border-r sm:bg-soft">
          <div className="flex items-center justify-between px-4 py-3 sm:py-4">
            <h2 className="text-base font-semibold">{t('settings.title')}</h2>
            <IconButton size="sm" className="sm:hidden" onClick={close} aria-label={t('common.close')}>
              <X />
            </IconButton>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-3 pb-2 sm:flex-col sm:overflow-visible sm:pb-3">
            {tabs.map((x) => (
              <button
                key={x.id}
                type="button"
                onClick={() => useUI.setState({ settingsTab: x.id })}
                className={cn(
                  'flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-colors [&_svg]:size-4',
                  x.id === active.id ? 'bg-hover font-medium text-fg' : 'text-fg-muted hover:bg-muted hover:text-fg',
                )}
              >
                {x.icon}
                {x.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col border-t border-line sm:border-t-0">
          <div className="hidden items-center justify-between border-b border-line px-5 py-3 sm:flex">
            <h3 className="text-sm font-semibold">{active.label}</h3>
            <IconButton size="sm" onClick={close} aria-label={t('common.close')}>
              <X />
            </IconButton>
          </div>
          <div className={cn('min-h-0 flex-1', active.id === 'providers' ? 'overflow-hidden' : 'overflow-y-auto')}>
            {active.id === 'providers' && <ProvidersTab />}
            {active.id === 'models' && <ModelsTab />}
            {active.id === 'general' && <GeneralTab />}
            {active.id === 'prompts' && <PromptsTab />}
            {active.id === 'usage' && <UsageTab />}
            {active.id === 'data' && <DataTab />}
            {active.id === 'account' && <AccountTab />}
            {active.id === 'admin' && isAdmin && <AdminTab />}
            {active.id === 'about' && <AboutTab />}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
