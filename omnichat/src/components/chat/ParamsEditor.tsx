import { useEffect, useState } from 'react';
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/primitives';
import type { ChatParams, ReasoningEffort } from '@/lib/types';
import { useT } from '@/i18n';

const EFFORTS: ReasoningEffort[] = ['default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

function SliderRow({
  label,
  hint,
  value,
  min,
  max,
  step,
  defaultValue,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number | undefined;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  onChange(v: number | undefined): void;
}) {
  const t = useT();
  const enabled = value !== undefined;
  return (
    <Field
      label={label}
      hint={hint}
      action={
        <div className="flex items-center gap-2 text-xs text-fg-subtle">
          {enabled ? value : t('params.default')}
          <Switch checked={enabled} onChange={(on) => onChange(on ? defaultValue : undefined)} label={label} />
        </div>
      }
    >
      {enabled && (
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full accent-[var(--accent)]"
        />
      )}
    </Field>
  );
}

export function ParamsEditor({ value, onChange }: { value: ChatParams; onChange(v: ChatParams): void }) {
  const t = useT();
  const [extra, setExtra] = useState(value.extraBody ? JSON.stringify(value.extraBody, null, 2) : '');
  const [extraError, setExtraError] = useState<string | null>(null);
  // Re-sync only on external changes, so typing is never reformatted.
  useEffect(() => {
    let current: string | undefined | null;
    try {
      current = extra.trim() ? JSON.stringify(JSON.parse(extra)) : undefined;
    } catch {
      current = null;
    }
    const incoming = value.extraBody ? JSON.stringify(value.extraBody) : undefined;
    if (current !== null && current !== incoming) setExtra(value.extraBody ? JSON.stringify(value.extraBody, null, 2) : '');
  }, [value.extraBody]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (p: Partial<ChatParams>) => {
    const next = { ...value, ...p };
    for (const k of Object.keys(next) as (keyof ChatParams)[]) if (next[k] === undefined) delete next[k];
    onChange(next);
  };

  return (
    <div className="space-y-5">
      <Field label={t('params.reasoning')} hint={t('params.reasoningHint')}>
        <Select value={value.reasoningEffort ?? 'default'} onChange={(e) => patch({ reasoningEffort: e.target.value === 'default' ? undefined : (e.target.value as ReasoningEffort) })}>
          {EFFORTS.map((e) => (
            <option key={e} value={e}>
              {t(`effort.${e}` as 'effort.default')}
            </option>
          ))}
        </Select>
      </Field>
      <SliderRow
        label={t('params.temperature')}
        hint={t('params.temperatureHint')}
        value={value.temperature}
        min={0}
        max={2}
        step={0.05}
        defaultValue={0.7}
        onChange={(v) => patch({ temperature: v })}
      />
      <SliderRow label="Top P" hint={t('params.topPHint')} value={value.topP} min={0} max={1} step={0.01} defaultValue={1} onChange={(v) => patch({ topP: v })} />
      <Field label={t('params.maxTokens')} hint={t('params.maxTokensHint')}>
        <Input
          type="number"
          min={1}
          placeholder={t('params.default')}
          value={value.maxTokens ?? ''}
          onChange={(e) => patch({ maxTokens: e.target.value ? Math.max(1, Number(e.target.value)) : undefined })}
        />
      </Field>
      <Field
        label={t('params.context')}
        hint={t('params.contextHint')}
        action={<span className="text-xs text-fg-subtle">{value.contextCount ? value.contextCount : t('params.all')}</span>}
      >
        <input
          type="range"
          min={0}
          max={50}
          step={1}
          value={value.contextCount ?? 0}
          onChange={(e) => patch({ contextCount: Number(e.target.value) || undefined })}
          className="w-full accent-[var(--accent)]"
        />
      </Field>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">{t('params.stream')}</div>
          <div className="text-xs text-fg-subtle">{t('params.streamHint')}</div>
        </div>
        <Switch checked={value.stream !== false} onChange={(v) => patch({ stream: v ? undefined : false })} />
      </div>
      <Field label={t('params.extraBody')} hint={extraError ?? t('params.extraBodyHint')}>
        <Textarea
          rows={4}
          spellCheck={false}
          value={extra}
          placeholder={'{\n  "presence_penalty": 0.5\n}'}
          className="font-mono text-xs"
          onChange={(e) => {
            const v = e.target.value;
            setExtra(v);
            if (!v.trim()) {
              setExtraError(null);
              patch({ extraBody: undefined });
              return;
            }
            try {
              const parsed = JSON.parse(v);
              if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
              setExtraError(null);
              patch({ extraBody: parsed });
            } catch {
              setExtraError(t('params.invalidJson'));
            }
          }}
        />
      </Field>
    </div>
  );
}
