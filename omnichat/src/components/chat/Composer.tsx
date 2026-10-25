import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, Brain, Check, FileText, Globe, Mic, Image as ImageIcon, Loader2, Paperclip, Square, X, File as FileIcon } from 'lucide-react';
import { IconButton, Popover } from '@/components/ui/primitives';
import { effortLabel, reasoningOptions } from '@/lib/ai/reasoning';
import type { ReasoningEffort } from '@/lib/types';
import { cn, formatBytes } from '@/lib/utils';
import { addFiles, clearDraft, draftKey, getDraft, setDraft, useComposer } from '@/store/composer';
import { resolveTarget, sendMessage, stopGeneration, useChat } from '@/store/chat';
import { updateConversation, useData } from '@/store/data';
import { effectiveSearchMode, loadWebSearch, useWebSearch } from '@/lib/ai/tools';
import { toast, useUI } from '@/store/ui';
import { browserSpeechSupported, recordingSupported, startBrowserSpeech, startRecording, type VoiceSession } from '@/lib/voice';
import { CompareButton, CompareChips } from './CompareButton';
import { ModelPicker, useActiveModel } from './ModelPicker';
import { useLang, useT } from '@/i18n';

/** Thinking effort of the open chat (or the new-chat draft); shown for reasoning models or once an effort is set. */
function ReasoningPicker() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const activeId = useUI((s) => s.activeId);
  const draft = useUI((s) => s.draft);
  const conv = useData((s) => (activeId ? s.conversations[activeId] : undefined));
  useData((s) => s.providers);
  const target = conv ? resolveTarget(conv.providerId, conv.model) : resolveTarget(draft.providerId, draft.model);
  const effort = (conv ? conv.params?.reasoningEffort : draft.reasoningEffort) ?? 'default';
  const opts = target ? reasoningOptions(target.provider, target.model) : null;
  if (!opts && effort === 'default') return null;
  // A level the model doesn't take (e.g. after switching models) stays listed so it can be seen and changed.
  const efforts: ReasoningEffort[] = ['default', ...(opts?.efforts ?? [])];
  if (!efforts.includes(effort)) efforts.push(effort);
  const label = (e: ReasoningEffort) => t(effortLabel(e, opts?.onOff) as 'effort.default');
  const pick = (e: ReasoningEffort) => {
    const v = e === 'default' ? undefined : e;
    if (conv) updateConversation(conv.id, { params: { ...conv.params, reasoningEffort: v } });
    else useUI.setState({ draft: { ...draft, reasoningEffort: v } });
    setOpen(false);
  };
  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t('params.reasoning')}
        className={cn(
          'focus-ring inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm transition-colors',
          effort !== 'default' ? 'bg-accent-soft text-accent' : 'text-fg-muted hover:bg-muted hover:text-fg',
        )}
      >
        <Brain className="size-[18px]" />
        <span className="hidden text-xs font-medium whitespace-nowrap sm:inline">
          {effort === 'default' ? t('params.reasoning') : label(effort)}
        </span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} width={200} className="p-1">
        <div className="px-2.5 pt-1.5 pb-1 text-xs font-medium text-fg-subtle">{t('params.reasoning')}</div>
        {efforts.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => pick(e)}
            className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-muted"
          >
            {label(e)}
            {e === effort && <Check className="size-4 text-accent" />}
          </button>
        ))}
      </Popover>
    </>
  );
}

const joinText = (a: string, b: string) => (a && b && !/\s$/.test(a) ? `${a} ${b}` : a + b);

/** Dictation: the browser's speech recognition, or a recording sent to the configured speech-to-text model. */
function VoiceButton({ draftKey: key }: { draftKey: string }) {
  const t = useT();
  const lang = useLang();
  const voice = useData((s) => s.settings.voiceInput);
  const provider = useData((s) => (voice ? s.providers[voice.providerId] : undefined));
  const [state, setState] = useState<'idle' | 'listening' | 'busy'>('idle');
  const session = useRef<VoiceSession | null>(null);
  const before = useRef('');
  useEffect(() => () => session.current?.cancel(), []);
  const usable = voice ? !!provider && !!voice.model && recordingSupported() : browserSpeechSupported();
  if (!usable) return null;

  const fail = (err: unknown) => toast(t('voice.failed', { error: (err as Error).message || String(err) }), 'error');
  const start = async () => {
    before.current = getDraft(key).text;
    try {
      session.current =
        voice && provider
          ? await startRecording(provider, voice.model)
          : startBrowserSpeech(lang === 'zh' ? 'zh-CN' : navigator.language || 'en-US', (partial) =>
              setDraft(key, { text: joinText(before.current, partial) }),
            );
      setState('listening');
    } catch (err) {
      fail(err);
    }
  };
  const stop = async () => {
    const s = session.current;
    session.current = null;
    if (!s) return;
    setState('busy');
    try {
      const text = await s.stop();
      if (!text) toast(t('voice.empty'));
      else setDraft(key, { text: joinText(voice ? getDraft(key).text : before.current, text) });
    } catch (err) {
      fail(err);
    } finally {
      setState('idle');
    }
  };
  const label = state === 'listening' ? t('voice.stop') : state === 'busy' ? t('voice.transcribing') : t('voice.start');
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={state === 'listening'}
      disabled={state === 'busy'}
      onClick={() => void (state === 'listening' ? stop() : start())}
      className={cn(
        'focus-ring inline-flex size-9 items-center justify-center rounded-lg transition-colors',
        state === 'listening' ? 'animate-pulse bg-danger/15 text-danger' : 'text-fg-muted hover:bg-muted hover:text-fg',
      )}
    >
      {state === 'busy' ? <Loader2 className="size-[18px] animate-spin" /> : <Mic className="size-[18px]" />}
    </button>
  );
}

/** Turns on provider-native web search; shown only when the current model's provider has one. */
function WebSearchToggle() {
  const t = useT();
  const activeId = useUI((s) => s.activeId);
  const draft = useUI((s) => s.draft);
  const conv = useData((s) => (activeId ? s.conversations[activeId] : undefined));
  useData((s) => s.providers);
  useWebSearch((s) => s.kind + String(s.ready));
  useEffect(() => void loadWebSearch(), []);
  const target = conv ? resolveTarget(conv.providerId, conv.model) : resolveTarget(draft.providerId, draft.model);
  const mode = target ? effectiveSearchMode(target.provider, target.model) : null;
  if (!mode || mode === 'builtin') return null;
  const on = conv ? !!conv.params?.webSearch : !!draft.webSearch;
  const toggle = () => {
    if (conv) updateConversation(conv.id, { params: { ...conv.params, webSearch: on ? undefined : true } });
    else useUI.setState({ draft: { ...draft, webSearch: !on } });
  };
  return (
    <button
      type="button"
      onClick={toggle}
      title={t('search.toggle')}
      aria-pressed={on}
      className={cn(
        'focus-ring inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm transition-colors',
        on ? 'bg-accent-soft text-accent' : 'text-fg-muted hover:bg-muted hover:text-fg',
      )}
    >
      <Globe className="size-[18px]" />
      <span className="hidden text-xs font-medium whitespace-nowrap sm:inline">{t('search.label')}</span>
    </button>
  );
}

export function Composer({ compact }: { compact?: boolean }) {
  const t = useT();
  const activeId = useUI((s) => s.activeId);
  const key = draftKey(activeId);
  const draft = useComposer((s) => s.drafts[key]);
  const busy = useComposer((s) => s.busy);
  const sendKey = useData((s) => s.settings.sendKey);
  const streaming = useChat((s) => (activeId ? !!s.streaming[activeId] : false));
  const text = draft?.text ?? '';
  const attachments = draft?.attachments ?? [];
  const compare = draft?.compare ?? [];
  const [model, setModel] = useActiveModel();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);

  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, Math.round(window.innerHeight * 0.4))}px`;
  }, [text]);

  // Focus on desktop only; on phones it would pop up the keyboard unasked.
  useEffect(() => {
    if (!window.matchMedia('(pointer: coarse)').matches) taRef.current?.focus();
  }, [activeId]);

  useEffect(() => {
    const onFocus = () => taRef.current?.focus();
    window.addEventListener('omnichat:focus-composer', onFocus);
    return () => window.removeEventListener('omnichat:focus-composer', onFocus);
  }, []);

  const canSend = (text.trim().length > 0 || attachments.length > 0) && !busy;

  const submit = async () => {
    if (!canSend || streaming) return;
    const d = getDraft(key);
    clearDraft(key);
    const ok = await sendMessage(d.text.trim(), d.attachments, d.compare);
    if (!ok) setDraft(key, d);
    // Keep comparing in the (possibly new) conversation until the user clears it.
    else if (d.compare?.length) setDraft(draftKey(useUI.getState().activeId), { compare: d.compare });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // keyCode 229: Safari reports the Enter that confirms an IME candidate this way.
    if (e.key !== 'Enter' || composing.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const mod = e.ctrlKey || e.metaKey;
    if (sendKey === 'enter') {
      if (e.shiftKey || coarse) return;
      if (mod) return;
      e.preventDefault();
      void submit();
    } else if (mod) {
      e.preventDefault();
      void submit();
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length) {
      e.preventDefault();
      void addFiles(files);
    }
  };

  return (
    <div className={cn('mx-auto w-full max-w-3xl px-3 sm:px-6', compact ? 'pb-0' : 'safe-bottom pb-3')}>
      <div className="rounded-3xl border border-line bg-elevated shadow-pop transition-colors focus-within:border-line-strong">
        <CompareChips value={compare} onChange={(v) => setDraft(key, { compare: v })} />
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {attachments.map((a) => (
              <div key={a.id} className="group relative">
                {a.kind === 'image' ? (
                  <img src={a.dataUrl} alt={a.name} className="size-16 rounded-xl border border-line object-cover" />
                ) : (
                  <div className="flex h-16 w-48 items-center gap-2 rounded-xl border border-line bg-bg px-3">
                    {a.kind === 'pdf' ? <FileIcon className="size-6 shrink-0 text-danger" /> : <FileText className="size-6 shrink-0 text-accent" />}
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-fg">{a.name}</div>
                      <div className="text-[11px] text-fg-subtle">{formatBytes(a.size)}</div>
                    </div>
                  </div>
                )}
                <button
                  type="button"
                  aria-label={t('common.remove')}
                  onClick={() => setDraft(key, { attachments: attachments.filter((x) => x.id !== a.id) })}
                  className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-fg text-bg shadow"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
            {busy && (
              <div className="flex size-16 items-center justify-center rounded-xl border border-dashed border-line">
                <Loader2 className="size-4 animate-spin text-fg-subtle" />
              </div>
            )}
          </div>
        )}
        <textarea
          ref={taRef}
          value={text}
          rows={1}
          placeholder={t('composer.placeholder')}
          onChange={(e) => setDraft(key, { text: e.target.value })}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onCompositionStart={() => (composing.current = true)}
          onCompositionEnd={() => (composing.current = false)}
          className="block max-h-[40vh] min-h-[52px] w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[0.95rem] leading-relaxed text-fg outline-none placeholder:text-fg-subtle"
        />
        <div className="flex items-center gap-1 px-2 pb-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <ModelPicker value={model} onChange={setModel} variant="composer" />
          <IconButton title={t('composer.attach')} aria-label={t('composer.attach')} onClick={() => fileRef.current?.click()}>
            <Paperclip />
          </IconButton>
          {/* Phones open the photo library from the paperclip too, so the image button makes room for the model name. */}
          <IconButton
            title={t('composer.image')}
            aria-label={t('composer.image')}
            className="max-sm:hidden"
            onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = 'image/*';
              input.multiple = true;
              input.onchange = () => input.files && void addFiles(input.files);
              input.click();
            }}
          >
            <ImageIcon />
          </IconButton>
          <VoiceButton draftKey={key} />
          <ReasoningPicker />
          <CompareButton value={compare} onChange={(v) => setDraft(key, { compare: v })} />
          <WebSearchToggle />
          <div className="ml-auto flex items-center gap-2">
            {streaming ? (
              <button
                key="stop"
                type="button"
                aria-label={t('composer.stop')}
                title={t('composer.stop')}
                onClick={() => activeId && stopGeneration(activeId)}
                className="focus-ring flex size-9 items-center justify-center rounded-full bg-fg text-bg transition-opacity hover:opacity-85"
              >
                <Square className="size-3.5 fill-current" />
              </button>
            ) : (
              <button
                key="send"
                type="button"
                aria-label={t('composer.send')}
                title={t('composer.send')}
                disabled={!canSend}
                onClick={() => void submit()}
                className="focus-ring flex size-9 items-center justify-center rounded-full bg-accent text-accent-fg transition-all hover:bg-accent-hover disabled:bg-line-strong disabled:text-fg-subtle"
              >
                <ArrowUp className="size-[18px]" strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
      </div>
      {!compact && (
        <p className="mt-2 hidden text-center text-[11px] text-fg-subtle sm:block">
          {sendKey === 'enter' ? t('composer.hintEnter') : t('composer.hintModEnter')} · {t('composer.disclaimer')}
        </p>
      )}
    </div>
  );
}
