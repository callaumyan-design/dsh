import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ExternalLink, Globe, Mic, XCircle } from 'lucide-react';
import { Button, Field, Input, Select } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { loadWebSearch, useWebSearch } from '@/lib/ai/tools';
import { isOpencodeGo } from '../../../shared/opencode-go';
import { browserSpeechSupported, recordingSupported, TRANSCRIBE_MODELS } from '@/lib/voice';
import { sortedProviders } from '@/store/chat';
import { updateSettings, useData } from '@/store/data';
import { toast } from '@/store/ui';
import { useT, type I18nKey } from '@/i18n';

const SERVICES: { id: string; name: string; keyUrl?: string; keyless?: boolean }[] = [
  { id: 'exa-free', name: 'Exa', keyless: true },
  { id: 'deepseek', name: 'DeepSeek', keyUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'tavily', name: 'Tavily', keyUrl: 'https://app.tavily.com/home' },
  { id: 'bocha', name: '博查 Bocha', keyUrl: 'https://open.bochaai.com/' },
  { id: 'brave', name: 'Brave Search', keyUrl: 'https://api-dashboard.search.brave.com/app/keys' },
  { id: 'exa', name: 'Exa', keyUrl: 'https://dashboard.exa.ai/api-keys' },
  { id: 'searxng', name: 'SearXNG', keyless: true },
];

const HINTS: Record<string, I18nKey> = {
  'exa-free': 'tools.exaFreeHint',
  deepseek: 'tools.deepseekHint',
  tavily: 'tools.tavilyHint',
  bocha: 'tools.bochaHint',
};

function WebSearchSection() {
  const t = useT();
  const cfg = useWebSearch();
  const [kind, setKind] = useState('');
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => void loadWebSearch(true), []);
  useEffect(() => {
    setKind(cfg.kind ?? '');
    setUrl(cfg.url ?? '');
  }, [cfg.kind, cfg.url]);

  const service = SERVICES.find((s) => s.id === kind);
  const save = async () => {
    setSaving(true);
    setTest(null);
    try {
      const body: Record<string, unknown> = { kind: kind || null, url: kind === 'searxng' ? url : undefined };
      if (key.trim()) body.apiKey = key.trim();
      const r = await api<typeof cfg>('/api/websearch/config', { method: 'PUT', body });
      useWebSearch.setState({ ...r, loaded: true });
      setKey('');
      toast(t('common.saved'), 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };
  const runTest = async () => {
    setTest(null);
    try {
      const r = await api<{ results: { title: string }[] }>('/api/websearch', { body: { query: 'OpenAI', count: 3 } });
      setTest({ ok: true, text: t('tools.testOk', { n: r.results.length, title: r.results[0]?.title ?? '' }) });
    } catch (err) {
      setTest({ ok: false, text: (err as Error).message });
    }
  };
  const dirty = kind !== (cfg.kind ?? '') || (kind === 'searxng' && url !== (cfg.url ?? '')) || !!key.trim();

  return (
    <section className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Globe className="size-4" />
          {t('tools.searchTitle')}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-fg-subtle">{t('tools.searchDesc')}</p>
      </div>
      <Field label={t('tools.service')} hint={kind === 'exa-free' ? t(HINTS[kind]) : undefined}>
        <Select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">{t('tools.serviceNone')}</option>
          {SERVICES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.id === 'exa-free' ? t('tools.exaFree') : s.name}
            </option>
          ))}
        </Select>
      </Field>
      {kind === 'searxng' && (
        <Field label={t('tools.searxngUrl')} hint={t('tools.searxngHint')}>
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://searx.example.com" className="font-mono" spellCheck={false} />
        </Field>
      )}
      {service && !service.keyless && (
        <Field
          label={t('provider.apiKey')}
          action={
            service?.keyUrl && (
              <a href={service.keyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-xs text-accent hover:underline">
                {t('provider.getKey')}
                <ExternalLink className="size-3" />
              </a>
            )
          }
          hint={HINTS[kind] && t(HINTS[kind])}
        >
          <Input
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={
              cfg.kind === kind && cfg.hasKey
                ? `${cfg.keyHint}（${t('provider.keyKeep')}）`
                : cfg.kind === kind && cfg.keyFrom
                  ? t('tools.keyFrom', { name: cfg.keyFrom })
                  : kind === 'deepseek'
                    ? t('tools.deepseekKeyOptional')
                    : 'API key'
            }
            className="font-mono"
          />
        </Field>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" loading={saving} disabled={!dirty} onClick={save}>
          {t('common.save')}
        </Button>
        {cfg.kind && (
          <Button size="sm" variant="outline" disabled={dirty} onClick={runTest}>
            {t('provider.test')}
          </Button>
        )}
      </div>
      {test && (
        <div className={`flex items-start gap-2 text-sm break-all ${test.ok ? 'text-success' : 'text-danger'}`}>
          {test.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <XCircle className="mt-0.5 size-4 shrink-0" />}
          <span>{test.text}</span>
        </div>
      )}
    </section>
  );
}

function VoiceSection() {
  const t = useT();
  const voice = useData((s) => s.settings.voiceInput);
  const providersMap = useData((s) => s.providers);
  // Transcription is an OpenAI-style endpoint; OpenCode Go has none.
  const providers = useMemo(
    () => sortedProviders().filter((p) => p.type === 'openai' && p.enabled !== false && !isOpencodeGo(p)),
    [providersMap], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [model, setModel] = useState(voice?.model ?? '');
  useEffect(() => setModel(voice?.model ?? ''), [voice?.model]);
  const browser = browserSpeechSupported();

  const pickProvider = (id: string) => {
    if (!id) return updateSettings({ voiceInput: undefined });
    const p = providersMap[id];
    const m = voice?.providerId === id && voice.model ? voice.model : (TRANSCRIBE_MODELS[p?.presetId ?? ''] ?? '');
    updateSettings({ voiceInput: { providerId: id, model: m } });
  };

  return (
    <section className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Mic className="size-4" />
          {t('tools.voiceTitle')}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-fg-subtle">{t('tools.voiceDesc')}</p>
      </div>
      <Field label={t('tools.voiceEngine')} hint={!voice && !browser ? t('tools.voiceNoBrowser') : undefined}>
        <Select value={voice?.providerId ?? ''} onChange={(e) => pickProvider(e.target.value)}>
          <option value="">{t('tools.voiceBrowser')}</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      {voice && (
        <Field label={t('tools.voiceModel')} hint={recordingSupported() ? t('tools.voiceModelHint') : t('tools.voiceNoMic')}>
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            onBlur={() => model.trim() !== voice.model && updateSettings({ voiceInput: { ...voice, model: model.trim() } })}
            placeholder="whisper-large-v3-turbo"
            className="font-mono"
            spellCheck={false}
          />
        </Field>
      )}
    </section>
  );
}

export function ToolsTab() {
  return (
    <div className="space-y-8 p-5">
      <WebSearchSection />
      <div className="border-t border-line" />
      <VoiceSection />
    </div>
  );
}
