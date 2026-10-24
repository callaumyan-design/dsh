import { useMemo, useRef, useState } from 'react';
import { Columns3, Search, X } from 'lucide-react';
import { Popover } from '@/components/ui/primitives';
import { ProviderAvatar } from '@/components/ui/ProviderAvatar';
import { cn } from '@/lib/utils';
import { sortedProviders, type ModelRef } from '@/store/chat';
import { useData } from '@/store/data';
import { useT } from '@/i18n';

const same = (a: ModelRef, b: ModelRef) => a.providerId === b.providerId && a.model === b.model;

/** Picks extra models that answer every message in parallel with the conversation's model. */
export function CompareButton({ value, onChange }: { value: ModelRef[]; onChange(v: ModelRef[]): void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const anchor = useRef<HTMLButtonElement>(null);
  const providersMap = useData((s) => s.providers);
  const providers = useMemo(() => sortedProviders().filter((p) => p.enabled !== false), [providersMap]); // eslint-disable-line react-hooks/exhaustive-deps
  const query = q.trim().toLowerCase();
  const toggle = (ref: ModelRef) => onChange(value.some((v) => same(v, ref)) ? value.filter((v) => !same(v, ref)) : [...value, ref].slice(0, 5));

  return (
    <>
      <button
        ref={anchor}
        type="button"
        title={t('compare.title')}
        aria-label={t('compare.title')}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'focus-ring inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm transition-colors',
          value.length ? 'bg-accent-soft text-accent' : 'text-fg-muted hover:bg-muted hover:text-fg',
        )}
      >
        <Columns3 className="size-[18px]" />
        {value.length > 0 && <span className="text-xs font-medium">+{value.length}</span>}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} width={320} className="p-0">
        <div className="border-b border-line p-3">
          <div className="text-sm font-medium">{t('compare.title')}</div>
          <div className="mt-0.5 text-xs text-fg-subtle">{t('compare.desc')}</div>
          <div className="mt-2 flex items-center gap-2 rounded-lg bg-muted px-2.5">
            <Search className="size-4 text-fg-subtle" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('model.search')}
              className="h-8 w-full bg-transparent text-sm outline-none placeholder:text-fg-subtle"
            />
          </div>
        </div>
        <div className="max-h-80 overflow-y-auto p-1">
          {providers.map((p) => {
            const models = p.models.filter((m) => !m.hidden && (!query || m.id.toLowerCase().includes(query) || p.name.toLowerCase().includes(query)));
            if (!models.length) return null;
            return (
              <div key={p.id} className="mb-1">
                <div className="flex items-center gap-2 px-2.5 pt-2 pb-1 text-xs font-medium text-fg-subtle">
                  <ProviderAvatar provider={p} size="xs" />
                  {p.name}
                </div>
                {models.map((m) => {
                  const ref = { providerId: p.id, model: m.id };
                  const checked = value.some((v) => same(v, ref));
                  return (
                    <label key={m.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm hover:bg-muted">
                      <input type="checkbox" checked={checked} onChange={() => toggle(ref)} className="size-4 accent-[var(--accent)]" />
                      <span className="truncate">{m.name || m.id}</span>
                    </label>
                  );
                })}
              </div>
            );
          })}
        </div>
        {value.length > 0 && (
          <div className="border-t border-line p-1">
            <button type="button" onClick={() => onChange([])} className="w-full rounded-lg px-2.5 py-2 text-left text-sm text-fg-muted hover:bg-muted hover:text-fg">
              {t('compare.clear')}
            </button>
          </div>
        )}
      </Popover>
    </>
  );
}

export function CompareChips({ value, onChange }: { value: ModelRef[]; onChange(v: ModelRef[]): void }) {
  const t = useT();
  const providers = useData((s) => s.providers);
  if (!value.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 pt-3 text-xs">
      <span className="text-fg-subtle">{t('compare.alsoAsk')}</span>
      {value.map((v) => {
        const p = v.providerId ? providers[v.providerId] : undefined;
        return (
          <span key={`${v.providerId}:${v.model}`} className="inline-flex items-center gap-1 rounded-full border border-line bg-bg py-0.5 pr-1 pl-1.5">
            <ProviderAvatar provider={p} name={p?.name ?? '?'} size="xs" />
            <span className="max-w-[10rem] truncate">{v.model}</span>
            <button type="button" aria-label={t('common.remove')} onClick={() => onChange(value.filter((x) => !same(x, v)))} className="rounded-full p-0.5 text-fg-subtle hover:bg-muted hover:text-fg">
              <X className="size-3" />
            </button>
          </span>
        );
      })}
    </div>
  );
}
