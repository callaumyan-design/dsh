import { Monitor, Moon, Sun } from 'lucide-react';
import { Field, Row, Segmented, Switch, Textarea } from '@/components/ui/primitives';
import { ModelPicker } from '@/components/chat/ModelPicker';
import { ParamsEditor } from '@/components/chat/ParamsEditor';
import { cn } from '@/lib/utils';
import type { Settings } from '@/lib/types';
import { updateSettings, useData } from '@/store/data';
import { useT } from '@/i18n';
import { ACCENTS } from '@/lib/theme';

export function ModelsTab() {
  const t = useT();
  const s = useData((st) => st.settings);
  return (
    <div className="space-y-6 p-5">
      <Field label={t('models.default')} hint={t('models.defaultHint')}>
        <ModelPicker
          variant="field"
          allowEmpty
          emptyLabel={t('models.auto')}
          value={{ providerId: s.defaultProviderId, model: s.defaultModel }}
          onChange={(v) => updateSettings({ defaultProviderId: v.providerId, defaultModel: v.model })}
        />
      </Field>
      <Field label={t('models.title')} hint={t('models.titleHint')}>
        <ModelPicker
          variant="field"
          allowEmpty
          emptyLabel={t('models.sameAsChat')}
          value={{ providerId: s.titleProviderId, model: s.titleModel }}
          onChange={(v) => updateSettings({ titleProviderId: v.providerId, titleModel: v.model })}
        />
      </Field>
      <Row title={t('models.autoTitle')} desc={t('models.autoTitleHint')}>
        <Switch checked={s.autoTitle} onChange={(v) => updateSettings({ autoTitle: v })} />
      </Row>
      <Field label={t('models.systemPrompt')} hint={t('models.systemPromptHint')}>
        <Textarea rows={4} value={s.defaultSystemPrompt ?? ''} onChange={(e) => updateSettings({ defaultSystemPrompt: e.target.value || undefined })} />
      </Field>
      <div>
        <div className="mb-3 text-sm font-semibold">{t('models.defaultParams')}</div>
        <ParamsEditor value={s.defaultParams ?? {}} onChange={(p) => updateSettings({ defaultParams: Object.keys(p).length ? p : undefined })} />
      </div>
    </div>
  );
}

export function GeneralTab() {
  const t = useT();
  const s = useData((st) => st.settings);
  const set = (p: Partial<Settings>) => updateSettings(p);
  return (
    <div className="divide-y divide-line px-5 py-2">
      <Row title={t('settings.theme')}>
        <Segmented
          value={s.theme}
          onChange={(theme) => set({ theme })}
          options={[
            { value: 'system', label: <Monitor className="size-3.5" /> },
            { value: 'light', label: <Sun className="size-3.5" /> },
            { value: 'dark', label: <Moon className="size-3.5" /> },
          ]}
        />
      </Row>
      <Row title={t('settings.accent')}>
        <div className="flex flex-wrap justify-end gap-1.5">
          {Object.entries(ACCENTS).map(([key, a]) => (
            <button
              key={key}
              type="button"
              aria-label={key}
              onClick={() => set({ accent: key })}
              className={cn('size-6 rounded-full ring-offset-2 ring-offset-bg transition-shadow', s.accent === key && 'ring-2 ring-fg')}
              style={{ background: a.light }}
            />
          ))}
        </div>
      </Row>
      <Row title={t('settings.language')}>
        <Segmented
          value={s.language}
          onChange={(language) => set({ language })}
          options={[
            { value: 'auto', label: t('settings.auto') },
            { value: 'zh', label: '中文' },
            { value: 'en', label: 'English' },
          ]}
        />
      </Row>
      <Row title={t('settings.fontSize')}>
        <Segmented
          value={s.fontSize}
          onChange={(fontSize) => set({ fontSize })}
          options={[
            { value: 'sm', label: t('settings.small') },
            { value: 'md', label: t('settings.medium') },
            { value: 'lg', label: t('settings.large') },
          ]}
        />
      </Row>
      <Row title={t('settings.sendKey')} desc={t('settings.sendKeyHint')}>
        <Segmented
          value={s.sendKey}
          onChange={(sendKey) => set({ sendKey })}
          options={[
            { value: 'enter', label: 'Enter' },
            { value: 'mod-enter', label: 'Ctrl + Enter' },
          ]}
        />
      </Row>
      <Row title={t('settings.codeWrap')} desc={t('settings.codeWrapHint')}>
        <Switch checked={s.codeWrap} onChange={(codeWrap) => set({ codeWrap })} />
      </Row>
      <Row title={t('settings.showUsage')} desc={t('settings.showUsageHint')}>
        <Switch checked={s.showUsage} onChange={(showUsage) => set({ showUsage })} />
      </Row>
      <Row title={t('settings.userMarkdown')} desc={t('settings.userMarkdownHint')}>
        <Switch checked={s.renderMarkdownForUser} onChange={(renderMarkdownForUser) => set({ renderMarkdownForUser })} />
      </Row>
    </div>
  );
}
