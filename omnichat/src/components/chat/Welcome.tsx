import { useMemo } from 'react';
import { KeyRound, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import { STARTERS } from '@/lib/builtinPrompts';
import { cn } from '@/lib/utils';
import { useData } from '@/store/data';
import { draftKey, setDraft } from '@/store/composer';
import { openSettings, useUI } from '@/store/ui';
import { useAuth, useDisplayName } from '@/store/auth';
import { useLang, useT } from '@/i18n';
import { Composer } from './Composer';
import { Logo } from '@/components/layout/Logo';

function greeting(t: ReturnType<typeof useT>) {
  const h = new Date().getHours();
  if (h < 6) return t('welcome.night');
  if (h < 12) return t('welcome.morning');
  if (h < 18) return t('welcome.afternoon');
  return t('welcome.evening');
}

export function Welcome() {
  const t = useT();
  const lang = useLang();
  const user = useAuth((s) => s.user);
  const name = useDisplayName();
  const providers = useData((s) => s.providers);
  const promptsMap = useData((s) => s.prompts);
  const draft = useUI((s) => s.draft);
  const hasModels = Object.values(providers).some((p) => p.enabled !== false && p.models.some((m) => !m.hidden));
  const prompts = useMemo(
    () => Object.values(promptsMap).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt - b.createdAt).slice(0, 8),
    [promptsMap],
  );

  const choosePrompt = (id: string) => {
    if (draft.promptId === id) {
      useUI.setState({ draft: { ...draft, promptId: undefined, systemPrompt: undefined } });
      return;
    }
    const p = promptsMap[id];
    useUI.setState({
      draft: {
        ...draft,
        promptId: id,
        systemPrompt: p.systemPrompt,
        ...(p.providerId && p.model ? { providerId: p.providerId, model: p.model } : {}),
      },
    });
    window.dispatchEvent(new Event('omnichat:focus-composer'));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-4 py-8 sm:px-6">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="mb-4 size-12" />
          <h1 className="text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
            {user ? t('welcome.withName', { greeting: greeting(t), name: name }) : greeting(t)}
          </h1>
          <p className="mt-2 text-sm text-fg-muted">{t('welcome.subtitle')}</p>
        </div>

        {!hasModels && (
          <div className="mx-auto mb-6 flex w-full max-w-lg flex-col items-center gap-3 rounded-2xl border border-dashed border-line-strong bg-soft p-6 text-center">
            <KeyRound className="size-6 text-accent" />
            <div>
              <div className="font-medium">{t('welcome.setupTitle')}</div>
              <div className="mt-1 text-sm text-fg-muted">{t('welcome.setupDesc')}</div>
            </div>
            <Button variant="primary" size="sm" onClick={() => openSettings('providers')}>
              {t('welcome.setupButton')}
            </Button>
          </div>
        )}

        <Composer compact />

        {prompts.length > 0 && (
          <div className="mt-5 flex flex-wrap justify-center gap-2 px-3">
            {prompts.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => choosePrompt(p.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors',
                  draft.promptId === p.id ? 'border-accent bg-accent-soft text-accent' : 'border-line text-fg-muted hover:bg-muted hover:text-fg',
                )}
                title={p.description || p.systemPrompt.slice(0, 120)}
              >
                <span>{p.icon || <Sparkles className="size-3.5" />}</span>
                {p.name}
              </button>
            ))}
          </div>
        )}

        <div className="mt-6 grid gap-2 px-3 sm:grid-cols-2">
          {STARTERS.map((s) => (
            <button
              key={s.icon}
              type="button"
              onClick={() => {
                setDraft(draftKey(null), { text: s.text[lang] });
                window.dispatchEvent(new Event('omnichat:focus-composer'));
              }}
              className="flex items-start gap-2.5 rounded-2xl border border-line px-4 py-3 text-left text-sm text-fg-muted transition-colors hover:bg-soft hover:text-fg"
            >
              <span className="text-base leading-5">{s.icon}</span>
              <span>{s.text[lang]}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
