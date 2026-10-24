import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Plus,
  Search,
  Trash2,
  Wifi,
  X,
  XCircle,
} from 'lucide-react';
import { Badge, Button, Field, IconButton, Input, Modal, Segmented, Select, Switch, Textarea } from '@/components/ui/primitives';
import { ProviderAvatar } from '@/components/ui/ProviderAvatar';
import { forgetProviderKey, listModels, testProvider } from '@/lib/ai';
import { guessReasoning, guessVision } from '@/lib/ai/capabilities';
import { PRESETS, getPreset, presetName, type ProviderPreset } from '@/lib/ai/presets';
import { joinUrl } from '../../../shared/provider-auth';
import type { AuthStyle, RequestMode } from '../../../shared/types';
import { cn, uid } from '@/lib/utils';
import type { ModelInfo, Provider } from '@/lib/types';
import { sortedProviders } from '@/store/chat';
import { removeProvider, saveProvider, useData } from '@/store/data';
import { confirmDialog, toast } from '@/store/ui';
import { useLang, useT } from '@/i18n';

function PresetPicker({ open, onClose, onPick }: { open: boolean; onClose(): void; onPick(p: ProviderPreset): void }) {
  const t = useT();
  const lang = useLang();
  const groups: { key: ProviderPreset['region']; label: string }[] = [
    { key: 'global', label: t('provider.regionGlobal') },
    { key: 'cn', label: t('provider.regionCn') },
    { key: 'local', label: t('provider.regionLocal') },
    { key: 'custom', label: t('provider.regionCustom') },
  ];
  return (
    <Modal open={open} onClose={onClose} title={t('provider.addTitle')} size="lg" mobileFull>
      <div className="space-y-5">
        {groups.map((g) => (
          <div key={g.key}>
            <div className="mb-2 text-xs font-medium text-fg-subtle">{g.label}</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {PRESETS.filter((p) => p.region === g.key).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onPick(p)}
                  className="flex items-center gap-3 rounded-xl border border-line p-3 text-left transition-colors hover:border-accent hover:bg-accent-soft"
                >
                  <ProviderAvatar presetId={p.id} name={p.name} size="lg" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-fg">{presetName(p, lang)}</div>
                    <div className="truncate text-xs text-fg-subtle">
                      {p.type === 'openai' ? 'OpenAI API' : p.type === 'anthropic' ? 'Anthropic API' : 'Gemini API'}
                      {p.baseUrl && ` · ${p.baseUrl.replace(/^https?:\/\//, '').split('/')[0]}`}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function jsonText(v: unknown) {
  return v && Object.keys(v as object).length ? JSON.stringify(v, null, 2) : '';
}

function parseJsonObject(s: string): Record<string, unknown> | undefined | null {
  if (!s.trim()) return undefined;
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

type TestState = { status: 'idle' } | { status: 'running' } | { status: 'ok'; ms: number; sample: string } | { status: 'fail'; error: string };

function ProviderEditor({ provider, onDeleted, onBack }: { provider: Provider; onDeleted(): void; onBack?(): void }) {
  const t = useT();
  const preset = getPreset(provider.presetId);
  const [name, setName] = useState(provider.name);
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl);
  const [mode, setMode] = useState<RequestMode>(provider.mode ?? 'proxy');
  const [authStyle, setAuthStyle] = useState<AuthStyle | ''>(provider.authStyle ?? '');
  const [models, setModels] = useState<ModelInfo[]>(provider.models ?? []);
  const [headers, setHeaders] = useState(jsonText(provider.headers));
  const [extraBody, setExtraBody] = useState(jsonText(provider.extraBody));
  const [useResponses, setUseResponses] = useState(!!provider.useResponsesApi);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [newModel, setNewModel] = useState('');
  const [filter, setFilter] = useState('');
  const [fetching, setFetching] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [test, setTest] = useState<TestState>({ status: 'idle' });
  const [testModel, setTestModel] = useState('');

  const parsedHeaders = parseJsonObject(headers);
  const parsedExtra = parseJsonObject(extraBody);
  const dirty =
    name !== provider.name ||
    baseUrl !== provider.baseUrl ||
    mode !== (provider.mode ?? 'proxy') ||
    authStyle !== (provider.authStyle ?? '') ||
    JSON.stringify(models) !== JSON.stringify(provider.models ?? []) ||
    headers !== jsonText(provider.headers) ||
    extraBody !== jsonText(provider.extraBody) ||
    useResponses !== !!provider.useResponsesApi ||
    apiKey !== '';

  const build = (): Provider | null => {
    if (parsedHeaders === null || parsedExtra === null) {
      toast(t('params.invalidJson'), 'error');
      return null;
    }
    const url = baseUrl.trim();
    if (url && !/^https?:\/\/[^\s]+$/i.test(url)) {
      toast(t('provider.invalidUrl'), 'error');
      return null;
    }
    const p: Provider = {
      ...provider,
      name: name.trim() || provider.name,
      baseUrl: url.replace(/\/+$/, ''),
      mode,
      authStyle: authStyle || undefined,
      models,
      headers: (parsedHeaders as Record<string, string>) ?? undefined,
      extraBody: parsedExtra ?? undefined,
      useResponsesApi: useResponses || undefined,
    };
    if (!p.useResponsesApi) delete p.useResponsesApi;
    if (!p.authStyle) delete p.authStyle;
    if (!p.headers) delete p.headers;
    if (!p.extraBody) delete p.extraBody;
    return p;
  };

  const save = (quiet = false): Provider | null => {
    const p = build();
    if (!p) return null;
    saveProvider(p, apiKey ? apiKey.trim() : undefined);
    if (apiKey) forgetProviderKey(p.id);
    setApiKey('');
    if (!quiet) toast(t('common.saved'), 'success');
    return useData.getState().providers[p.id] ?? p;
  };

  const fetchModels = async () => {
    const p = dirty ? save(true) : provider;
    if (!p) return;
    if (!p.baseUrl) return toast(t('provider.needUrl'), 'error');
    setFetching(true);
    try {
      const fetched = await listModels(p);
      const existing = new Set(models.map((m) => m.id));
      const fresh = fetched.filter((m) => !existing.has(m.id));
      const show = models.length === 0 && fetched.length <= 40;
      const next = [...models, ...fresh.map((m) => ({ id: m.id, name: m.name, hidden: !show }))];
      setModels(next);
      saveProvider({ ...p, models: next });
      toast(
        t(show || !fresh.length ? 'provider.fetched' : 'provider.fetchedHidden', { total: fetched.length, added: fresh.length }),
        'success',
        show ? 3200 : 6000,
      );
    } catch (err) {
      toast(`${t('provider.fetchFailed')}: ${(err as Error).message}`, 'error', 6000);
    } finally {
      setFetching(false);
    }
  };

  const runTest = async () => {
    const p = dirty ? save(true) : provider;
    if (!p) return;
    const model = testModel || models.find((m) => !m.hidden)?.id || models[0]?.id;
    if (!model) return toast(t('provider.needModel'), 'error');
    setTest({ status: 'running' });
    try {
      const r = await testProvider(p, model);
      setTest({ status: 'ok', ...r });
    } catch (err) {
      setTest({ status: 'fail', error: (err as Error).message });
    }
  };

  const addModel = () => {
    const ids = newModel
      .split(/[,，\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!ids.length) return;
    const existing = new Set(models.map((m) => m.id));
    setModels([...models, ...ids.filter((id) => !existing.has(id)).map((id) => ({ id }))]);
    setNewModel('');
  };

  const q = filter.trim().toLowerCase();
  const shown = q ? models.filter((m) => m.id.toLowerCase().includes(q) || m.name?.toLowerCase().includes(q)) : models;
  const visibleCount = models.filter((m) => !m.hidden).length;
  const endpoint =
    provider.type === 'anthropic'
      ? '/messages'
      : provider.type === 'gemini'
        ? '/models/{model}:streamGenerateContent'
        : useResponses
          ? '/responses'
          : '/chat/completions';

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-line px-5 py-3">
        {onBack && (
          <IconButton size="sm" className="md:hidden" onClick={onBack} aria-label={t('common.back')}>
            <ArrowLeft />
          </IconButton>
        )}
        <ProviderAvatar provider={{ name, presetId: provider.presetId }} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{name || provider.name}</div>
          <div className="text-xs text-fg-subtle">
            {provider.type === 'openai' ? 'OpenAI API' : provider.type === 'anthropic' ? 'Anthropic API' : 'Gemini API'}
            {preset?.keyUrl && (
              <a href={preset.keyUrl} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-0.5 text-accent hover:underline">
                {t('provider.getKey')}
                <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        </div>
        <Switch
          checked={provider.enabled !== false}
          onChange={(v) => saveProvider({ ...provider, enabled: v })}
          label={t('provider.enabled')}
        />
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
        <Field label={t('provider.name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        {!preset?.noKey || provider.hasKey ? (
          <Field
            label={t('provider.apiKey')}
            hint={provider.hasKey ? t('provider.keyStored', { hint: provider.keyHint ?? '' }) : t('provider.keyHint')}
            action={
              provider.hasKey && (
                <button
                  type="button"
                  className="text-xs text-danger hover:underline"
                  onClick={async () => {
                    if (await confirmDialog({ title: t('provider.clearKey'), danger: true })) {
                      saveProvider(provider, '');
                      forgetProviderKey(provider.id);
                    }
                  }}
                >
                  {t('provider.clearKey')}
                </button>
              )
            }
          >
            <div className="relative">
              <Input
                type={showKey ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={provider.hasKey ? `${provider.keyHint ?? '••••'} (${t('provider.keyKeep')})` : 'sk-...'}
                className="pr-10 font-mono"
              />
              <button
                type="button"
                className="absolute top-1/2 right-2 -translate-y-1/2 p-1 text-fg-subtle hover:text-fg"
                onClick={() => setShowKey((v) => !v)}
                aria-label="toggle"
              >
                {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </Field>
        ) : null}

        <Field label={t('provider.baseUrl')} hint={baseUrl ? `${t('provider.endpoint')}: ${joinUrl(baseUrl, endpoint)}` : t('provider.baseUrlHint')}>
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" spellCheck={false} className="font-mono" />
        </Field>

        <Field label={t('provider.mode')} hint={mode === 'direct' ? t('provider.modeDirectHint') : t('provider.modeProxyHint')}>
          <Segmented<RequestMode>
            value={mode}
            onChange={setMode}
            options={[
              { value: 'proxy', label: t('provider.modeProxy') },
              { value: 'direct', label: t('provider.modeDirect') },
            ]}
          />
        </Field>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-medium">
              {t('provider.models')}
              <span className="ml-1.5 text-xs font-normal text-fg-subtle">
                {t('provider.modelsCount', { shown: visibleCount, total: models.length })}
              </span>
            </div>
            <div className="ml-auto flex gap-1.5">
              {models.length > 0 && (
                <>
                  <Button size="xs" variant="ghost" onClick={() => setModels(models.map((m) => ({ ...m, hidden: false })))}>
                    {t('provider.showAll')}
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => setModels(models.map((m) => ({ ...m, hidden: true })))}>
                    {t('provider.hideAll')}
                  </Button>
                </>
              )}
              <Button size="xs" variant="outline" loading={fetching} icon={<Download className="size-3.5" />} onClick={fetchModels}>
                {t('provider.fetchModels')}
              </Button>
            </div>
          </div>
          {models.length > 8 && (
            <div className="flex h-8 items-center gap-2 rounded-lg border border-line px-2.5">
              <Search className="size-3.5 text-fg-subtle" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t('model.search')}
                className="h-full flex-1 bg-transparent text-sm outline-none placeholder:text-fg-subtle"
              />
            </div>
          )}
          <div className="max-h-72 overflow-y-auto rounded-xl border border-line">
            {shown.length === 0 && <div className="px-3 py-6 text-center text-sm text-fg-subtle">{t('provider.noModels')}</div>}
            {shown.map((m) => (
              <div key={m.id} className="group flex items-center gap-2.5 border-b border-line px-3 py-2 last:border-0 hover:bg-soft">
                <input
                  type="checkbox"
                  checked={!m.hidden}
                  onChange={(e) => setModels(models.map((x) => (x.id === m.id ? { ...x, hidden: !e.target.checked } : x)))}
                  className="size-4 accent-[var(--accent)]"
                />
                <span className="min-w-0 flex-1 truncate font-mono text-[13px]" title={m.id}>
                  {m.id}
                  {m.name && <span className="ml-2 font-sans text-xs text-fg-subtle">{m.name}</span>}
                </span>
                {guessVision(m.id) && <Badge>{t('model.vision')}</Badge>}
                {guessReasoning(m.id) && <Badge>{t('model.reasoning')}</Badge>}
                <button
                  type="button"
                  className="text-fg-subtle opacity-100 hover:text-danger md:opacity-0 md:group-hover:opacity-100"
                  onClick={() => setModels(models.filter((x) => x.id !== m.id))}
                  aria-label={t('common.remove')}
                >
                  <X className="size-4" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={newModel}
              onChange={(e) => setNewModel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  addModel();
                }
              }}
              placeholder={t('provider.addModelPlaceholder')}
              className="h-9 font-mono text-[13px]"
            />
            <Button size="sm" variant="outline" className="h-9" icon={<Plus className="size-4" />} onClick={addModel}>
              {t('common.add')}
            </Button>
          </div>
        </div>

        <div className="space-y-2 rounded-xl border border-line p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select className="h-9 min-w-0 flex-1" value={testModel} onChange={(e) => setTestModel(e.target.value)}>
              <option value="">{t('provider.testAuto')}</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}
                </option>
              ))}
            </Select>
            <Button size="sm" variant="outline" className="h-9" loading={test.status === 'running'} icon={<Wifi className="size-4" />} onClick={runTest}>
              {t('provider.test')}
            </Button>
          </div>
          {test.status === 'ok' && (
            <div className="flex items-start gap-2 text-sm text-success">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              <span>
                {t('provider.testOk', { ms: test.ms })}
                {test.sample && <span className="text-fg-muted"> · “{test.sample.slice(0, 40)}”</span>}
              </span>
            </div>
          )}
          {test.status === 'fail' && (
            <div className="flex items-start gap-2 text-sm break-all text-danger">
              <XCircle className="mt-0.5 size-4 shrink-0" />
              <span>{test.error}</span>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-line">
          <button type="button" onClick={() => setAdvanced((v) => !v)} className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium">
            {t('provider.advanced')}
            <ChevronDown className={cn('size-4 transition-transform', advanced && 'rotate-180')} />
          </button>
          {advanced && (
            <div className="space-y-4 border-t border-line px-3 py-3">
              {provider.type === 'openai' && (
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-medium">{t('provider.responsesApi')}</div>
                    <div className="mt-0.5 text-xs leading-relaxed text-fg-subtle">{t('provider.responsesApiHint')}</div>
                  </div>
                  <Switch checked={useResponses} onChange={setUseResponses} label={t('provider.responsesApi')} />
                </div>
              )}
              <Field label={t('provider.authStyle')} hint={t('provider.authStyleHint')}>
                <Select value={authStyle} onChange={(e) => setAuthStyle(e.target.value as AuthStyle | '')}>
                  <option value="">{t('provider.authDefault')}</option>
                  <option value="bearer">Authorization: Bearer</option>
                  <option value="x-api-key">x-api-key</option>
                  <option value="api-key">api-key (Azure)</option>
                  <option value="x-goog-api-key">x-goog-api-key</option>
                  <option value="none">{t('provider.authNone')}</option>
                </Select>
              </Field>
              <Field label={t('provider.headers')} hint={parsedHeaders === null ? t('params.invalidJson') : t('provider.headersHint')}>
                <Textarea rows={3} spellCheck={false} className="font-mono text-xs" value={headers} onChange={(e) => setHeaders(e.target.value)} placeholder={'{\n  "X-Custom": "value"\n}'} />
              </Field>
              <Field label={t('params.extraBody')} hint={parsedExtra === null ? t('params.invalidJson') : t('provider.extraBodyHint')}>
                <Textarea rows={3} spellCheck={false} className="font-mono text-xs" value={extraBody} onChange={(e) => setExtraBody(e.target.value)} placeholder={'{\n  "stream_options": null\n}'} />
              </Field>
            </div>
          )}
        </div>
      </div>

      <div className="safe-bottom flex items-center gap-2 border-t border-line px-5 py-3">
        <Button
          size="sm"
          variant="ghost"
          className="text-danger hover:bg-danger/10 hover:text-danger"
          icon={<Trash2 className="size-4" />}
          onClick={async () => {
            if (await confirmDialog({ title: t('provider.deleteConfirm', { name: provider.name }), danger: true, confirmText: t('common.delete') })) {
              removeProvider(provider.id);
              forgetProviderKey(provider.id);
              onDeleted();
            }
          }}
        >
          {t('common.delete')}
        </Button>
        <div className="ml-auto flex items-center gap-2">
          {dirty && <span className="text-xs text-warning">{t('common.unsaved')}</span>}
          <Button size="sm" variant="primary" disabled={!dirty} onClick={() => save()}>
            {t('common.save')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ProvidersTab() {
  const t = useT();
  const lang = useLang();
  const providersMap = useData((s) => s.providers);
  const providers = useMemo(() => sortedProviders(), [providersMap]); // eslint-disable-line react-hooks/exhaustive-deps
  const [selected, setSelected] = useState<string | null>(null);
  const [mobileEditing, setMobileEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const current = (selected && providersMap[selected]) || providers[0];

  const create = (preset: ProviderPreset) => {
    const p: Provider = {
      id: uid(),
      name: preset.region === 'custom' ? t(`provider.customName.${preset.type}` as 'provider.customName.openai') : presetName(preset, lang),
      type: preset.type,
      presetId: preset.id,
      baseUrl: preset.baseUrl,
      authStyle: preset.authStyle,
      mode: preset.mode ?? 'proxy',
      enabled: true,
      models: preset.models.map((id) => ({ id })),
      headers: preset.headers,
      createdAt: Date.now(),
      order: providers.length,
    };
    if (!p.authStyle) delete p.authStyle;
    if (!p.headers) delete p.headers;
    saveProvider(p);
    setSelected(p.id);
    setMobileEditing(true);
    setAdding(false);
  };

  return (
    <div className="flex h-full min-h-0">
      <div className={cn('flex w-full flex-col border-line md:w-60 md:border-r', mobileEditing && current && 'max-md:hidden')}>
        <div className="p-3">
          <Button variant="primary" size="sm" className="w-full" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
            {t('provider.add')}
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {providers.length === 0 && <div className="px-3 py-8 text-center text-sm text-fg-subtle">{t('provider.empty')}</div>}
          {providers.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setSelected(p.id);
                setMobileEditing(true);
              }}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                current?.id === p.id ? 'bg-hover' : 'hover:bg-muted',
              )}
            >
              <ProviderAvatar provider={p} size="md" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{p.name}</div>
                <div className="truncate text-xs text-fg-subtle">
                  {p.models.filter((m) => !m.hidden).length} {t('provider.modelsShort')}
                  {!p.hasKey && !getPreset(p.presetId)?.noKey && <span className="ml-1.5 text-warning">· {t('provider.noKey')}</span>}
                </div>
              </div>
              {p.enabled === false && <Badge>{t('provider.disabled')}</Badge>}
            </button>
          ))}
        </div>
      </div>
      <div className={cn('min-w-0 flex-1', !mobileEditing && 'max-md:hidden')}>
        {current ? (
          <ProviderEditor
            key={current.id}
            provider={current}
            onBack={() => setMobileEditing(false)}
            onDeleted={() => {
              setSelected(null);
              setMobileEditing(false);
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-center text-sm text-fg-subtle">{t('provider.selectHint')}</div>
        )}
      </div>
      <PresetPicker open={adding} onClose={() => setAdding(false)} onPick={create} />
    </div>
  );
}
