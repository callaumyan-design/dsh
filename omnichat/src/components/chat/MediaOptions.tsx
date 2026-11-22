// Options of image and video generation models: in the composer (quick picks) and in the chat settings panel.
import { useRef, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Field, Popover, Textarea } from '@/components/ui/primitives';
import { ASPECTS, modelOutput } from '@/lib/ai/media';
import type { MediaParams } from '@/lib/types';
import { cn } from '@/lib/utils';
import { resolveTarget } from '@/store/chat';
import { updateConversation, useData } from '@/store/data';
import { useUI } from '@/store/ui';
import { useT } from '@/i18n';

const SECONDS = [4, 5, 6, 8, 10, 12];
const RESOLUTIONS: NonNullable<MediaParams['resolution']>[] = ['480p', '720p', '1080p'];
const QUALITIES: NonNullable<MediaParams['quality']>[] = ['low', 'medium', 'high'];

function Chips<T extends string | number>({
  value,
  options,
  label,
  onChange,
}: {
  value: T | undefined;
  options: T[];
  label(v: T): string;
  onChange(v: T | undefined): void;
}) {
  const t = useT();
  const chip = (active: boolean) =>
    cn(
      'rounded-lg border px-2 py-1 text-xs transition-colors',
      active ? 'border-accent bg-accent-soft text-accent' : 'border-line text-fg-muted hover:bg-muted hover:text-fg',
    );
  return (
    <div className="flex flex-wrap gap-1.5">
      <button type="button" className={chip(value === undefined)} onClick={() => onChange(undefined)}>
        {t('media.default')}
      </button>
      {options.map((o) => (
        <button key={String(o)} type="button" className={chip(value === o)} onClick={() => onChange(o)}>
          {label(o)}
        </button>
      ))}
    </div>
  );
}

export function MediaParamsEditor({
  kind,
  value,
  onChange,
  full,
}: {
  kind: 'image' | 'video';
  value: MediaParams;
  onChange(v: MediaParams | undefined): void;
  /** Also offer the negative prompt (chat settings panel). */
  full?: boolean;
}) {
  const t = useT();
  const patch = (p: Partial<MediaParams>) => {
    const next: MediaParams = { ...value, ...p };
    for (const k of Object.keys(next) as (keyof MediaParams)[]) if (next[k] === undefined || next[k] === '') delete next[k];
    onChange(Object.keys(next).length ? next : undefined);
  };
  const quality = { low: t('media.qualityLow'), medium: t('media.qualityMedium'), high: t('media.qualityHigh') };
  return (
    <div className="space-y-3.5">
      <Field label={t('media.aspect')}>
        <Chips value={value.aspect} options={ASPECTS} label={(a) => a} onChange={(aspect) => patch({ aspect })} />
      </Field>
      {kind === 'image' ? (
        <>
          <Field label={t('media.count')}>
            <Chips value={value.count} options={[1, 2, 3, 4]} label={(n) => String(n)} onChange={(count) => patch({ count })} />
          </Field>
          <Field label={t('media.quality')}>
            <Chips value={value.quality} options={QUALITIES} label={(q) => quality[q]} onChange={(q) => patch({ quality: q })} />
          </Field>
        </>
      ) : (
        <>
          <Field label={t('media.seconds')}>
            <Chips value={value.seconds} options={SECONDS} label={(n) => t('media.secondsN', { n })} onChange={(seconds) => patch({ seconds })} />
          </Field>
          <Field label={t('media.resolution')}>
            <Chips value={value.resolution} options={RESOLUTIONS} label={(r) => r} onChange={(resolution) => patch({ resolution })} />
          </Field>
        </>
      )}
      {full && (
        <Field label={t('media.negative')} hint={t('media.negativeHint')}>
          <Textarea rows={2} value={value.negativePrompt ?? ''} onChange={(e) => patch({ negativePrompt: e.target.value || undefined })} />
        </Field>
      )}
      <p className="text-[11px] leading-relaxed text-fg-subtle">{t('media.optionsHint')}</p>
    </div>
  );
}

/** What the open chat (or the new-chat draft) generates, with its media options and a setter. */
export function useActiveMedia(): { kind: 'image' | 'video' | null; value: MediaParams; set(v: MediaParams | undefined): void } {
  const activeId = useUI((s) => s.activeId);
  const draft = useUI((s) => s.draft);
  const conv = useData((s) => (activeId ? s.conversations[activeId] : undefined));
  useData((s) => s.providers);
  const target = conv ? resolveTarget(conv.providerId, conv.model) : resolveTarget(draft.providerId, draft.model);
  const output = target ? modelOutput(target.provider, target.model) : 'text';
  const value = (conv ? conv.params?.media : draft.media) ?? {};
  const set = (media: MediaParams | undefined) => {
    if (conv) updateConversation(conv.id, { params: { ...conv.params, media } });
    else useUI.setState({ draft: { ...useUI.getState().draft, media } });
  };
  return { kind: output === 'text' ? null : output, value, set };
}

/** Composer button for the options of the current image or video model. */
export function MediaOptionsButton() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const { kind, value, set } = useActiveMedia();
  if (!kind) return null;
  const summary = [value.aspect, kind === 'image' && value.count && value.count > 1 ? `×${value.count}` : '', kind === 'video' && value.seconds ? t('media.secondsN', { n: value.seconds }) : '']
    .filter(Boolean)
    .join(' · ');
  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t('media.options')}
        data-media-options=""
        className={cn(
          'focus-ring inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm transition-colors',
          summary ? 'bg-accent-soft text-accent' : 'text-fg-muted hover:bg-muted hover:text-fg',
        )}
      >
        <SlidersHorizontal className="size-[18px]" />
        <span className="hidden text-xs font-medium whitespace-nowrap sm:inline">{summary || t('media.options')}</span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} width={300} className="p-3">
        <MediaParamsEditor kind={kind} value={value} onChange={set} />
      </Popover>
    </>
  );
}
