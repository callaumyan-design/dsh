import { useMemo, useRef, useState } from 'react';
import { Brain, Check, ChevronDown, Eye, Search, Settings2, Star } from 'lucide-react';
import { Popover } from '@/components/ui/primitives';
import { ProviderAvatar } from '@/components/ui/ProviderAvatar';
import { guessReasoning, guessVision } from '@/lib/ai/capabilities';
import { cn } from '@/lib/utils';
import { modelKey, type Provider } from '@/lib/types';
import { updateConversation, updateSettings, useData } from '@/store/data';
import { resolveTarget, sortedProviders } from '@/store/chat';
import { openSettings, useUI } from '@/store/ui';
import { useT } from '@/i18n';

export interface ModelValue {
  providerId?: string;
  model?: string;
}

/** The model the open chat (or the new-chat draft) will use, and a setter that stores the choice there. */
export function useActiveModel(): [ModelValue, (v: ModelValue) => void] {
  const activeId = useUI((s) => s.activeId);
  const draft = useUI((s) => s.draft);
  const conv = useData((s) => (activeId ? s.conversations[activeId] : undefined));
  // Re-render when providers or the default model change so the fallback below stays current.
  useData((s) => s.providers);
  useData((s) => s.settings.defaultModel);
  const fallback = !conv && !draft.model ? resolveTarget() : null;
  const value = conv
    ? { providerId: conv.providerId, model: conv.model }
    : fallback
      ? { providerId: fallback.provider.id, model: fallback.model }
      : { providerId: draft.providerId, model: draft.model };
  const set = (v: ModelValue) => {
    if (conv) updateConversation(conv.id, { providerId: v.providerId, model: v.model });
    else useUI.setState({ draft: { ...useUI.getState().draft, providerId: v.providerId, model: v.model } });
  };
  return [value, set];
}

function ModelBadges({ id }: { id: string }) {
  return (
    <span className="flex items-center gap-1 text-fg-subtle">
      {guessVision(id) && <Eye className="size-3.5" />}
      {guessReasoning(id) && <Brain className="size-3.5" />}
    </span>
  );
}

export function ModelPicker({
  value,
  onChange,
  variant = 'header',
  allowEmpty,
  emptyLabel,
}: {
  value: ModelValue;
  onChange(v: ModelValue): void;
  variant?: 'header' | 'field' | 'composer';
  allowEmpty?: boolean;
  emptyLabel?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const anchor = useRef<HTMLButtonElement>(null);
  const providersMap = useData((s) => s.providers);
  const favorites = useData((s) => s.settings.favoriteModels);
  const providers = useMemo(() => sortedProviders().filter((p) => p.enabled !== false), [providersMap]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = value.providerId ? providersMap[value.providerId] : undefined;
  const query = q.trim().toLowerCase();
  const match = (p: Provider, id: string, name?: string) =>
    !query || id.toLowerCase().includes(query) || (name ?? '').toLowerCase().includes(query) || p.name.toLowerCase().includes(query);

  const favList = favorites
    .map((k) => {
      const [pid, ...rest] = k.split('::');
      const p = providersMap[pid];
      const model = rest.join('::');
      return p && p.enabled !== false ? { p, model } : null;
    })
    .filter((x): x is { p: Provider; model: string } => !!x && match(x.p, x.model));

  const toggleFav = (pid: string, model: string) => {
    const k = modelKey(pid, model);
    updateSettings({ favoriteModels: favorites.includes(k) ? favorites.filter((f) => f !== k) : [...favorites, k] });
  };

  const pick = (v: ModelValue) => {
    onChange(v);
    setOpen(false);
    setQ('');
  };

  const row = (p: Provider, id: string, name?: string, showProvider?: boolean) => {
    const selected = value.providerId === p.id && value.model === id;
    const fav = favorites.includes(modelKey(p.id, id));
    return (
      <div
        key={`${p.id}:${id}`}
        role="button"
        tabIndex={0}
        onClick={() => pick({ providerId: p.id, model: id })}
        onKeyDown={(e) => e.key === 'Enter' && pick({ providerId: p.id, model: id })}
        className={cn('group flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm hover:bg-muted', selected && 'bg-accent-soft')}
      >
        {showProvider && <ProviderAvatar provider={p} size="xs" />}
        <span className="min-w-0 flex-1 truncate" title={id}>
          {name || id}
          {showProvider && <span className="ml-1.5 text-xs text-fg-subtle">{p.name}</span>}
        </span>
        <ModelBadges id={id} />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggleFav(p.id, id);
          }}
          className={cn('rounded p-0.5 text-fg-subtle hover:text-warning', fav ? 'text-warning' : 'opacity-0 group-hover:opacity-100 max-md:opacity-60')}
          aria-label="favorite"
        >
          <Star className={cn('size-3.5', fav && 'fill-current')} />
        </button>
        {selected ? <Check className="size-4 text-accent" /> : <span className="size-4" />}
      </div>
    );
  };

  const label = value.model ? value.model : (emptyLabel ?? t('model.select'));

  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'focus-ring flex min-w-0 items-center gap-2 text-left transition-colors',
          variant === 'header'
            ? 'h-9 max-w-[min(60vw,22rem)] rounded-xl px-2.5 hover:bg-muted'
            : variant === 'composer'
              ? 'h-9 max-w-[min(42vw,15rem)] gap-1.5 rounded-lg px-2 text-fg-muted hover:bg-muted hover:text-fg'
              : 'h-10 w-full rounded-xl border border-line bg-bg px-3 hover:border-line-strong',
          open && variant !== 'field' && 'bg-muted text-fg',
        )}
      >
        {current ? <ProviderAvatar provider={current} size={variant === 'composer' ? 'xs' : 'sm'} /> : null}
        <span
          className={cn(
            'min-w-0 truncate',
            variant === 'composer' ? 'text-xs font-medium' : 'text-sm',
            variant === 'header' && 'font-semibold',
            !value.model && 'text-fg-subtle',
          )}
        >
          {label}
        </span>
        <ChevronDown className={cn('ml-auto shrink-0 text-fg-subtle', variant === 'composer' ? 'size-3.5' : 'size-4')} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} width={340} className="p-0">
        <div className="sticky top-0 z-10 border-b border-line bg-elevated p-2">
          <div className="flex items-center gap-2 rounded-lg bg-muted px-2.5">
            <Search className="size-4 text-fg-subtle" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('model.search')}
              className="h-8 w-full bg-transparent text-sm outline-none placeholder:text-fg-subtle"
            />
          </div>
        </div>
        <div className="p-1">
          {allowEmpty && (
            <div
              role="button"
              tabIndex={0}
              onClick={() => pick({})}
              className={cn('flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm hover:bg-muted', !value.model && 'bg-accent-soft')}
            >
              <span className="flex-1 text-fg-muted">{emptyLabel}</span>
              {!value.model && <Check className="size-4 text-accent" />}
            </div>
          )}
          {favList.length > 0 && (
            <div className="mb-1">
              <div className="px-2.5 pt-2 pb-1 text-xs font-medium text-fg-subtle">{t('model.favorites')}</div>
              {favList.map(({ p, model }) => row(p, model, p.models.find((m) => m.id === model)?.name, true))}
            </div>
          )}
          {providers.map((p) => {
            const models = p.models.filter((m) => !m.hidden && match(p, m.id, m.name));
            if (!models.length) return null;
            return (
              <div key={p.id} className="mb-1">
                <div className="flex items-center gap-2 px-2.5 pt-2 pb-1 text-xs font-medium text-fg-subtle">
                  <ProviderAvatar provider={p} size="xs" />
                  {p.name}
                </div>
                {models.map((m) => row(p, m.id, m.name))}
              </div>
            );
          })}
          {!providers.some((p) => p.models.some((m) => !m.hidden)) && (
            <div className="px-3 py-6 text-center text-sm text-fg-subtle">{t('model.none')}</div>
          )}
        </div>
        <div className="sticky bottom-0 border-t border-line bg-elevated p-1">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              openSettings('providers');
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-fg-muted hover:bg-muted hover:text-fg"
          >
            <Settings2 className="size-4" />
            {t('model.manage')}
          </button>
        </div>
      </Popover>
    </>
  );
}
