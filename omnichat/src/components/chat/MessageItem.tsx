import { memo, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Brain,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Check,
  FileText,
  GitBranch,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Square,
  Trash2,
  Volume2,
  File as FileIcon,
} from 'lucide-react';
import { Button, Dropdown, IconButton, MenuDivider, MenuItem, Modal, Textarea } from '@/components/ui/primitives';
import { ProviderAvatar } from '@/components/ui/ProviderAvatar';
import { cn, copyText, formatBytes, formatDuration, formatNumber } from '@/lib/utils';
import type { Attachment, Message } from '@/lib/types';
import { deleteMessage, editMessage, forkConversation, regenerate, retryLast, switchVersion } from '@/store/chat';
import { useData } from '@/store/data';
import { confirmDialog, toast } from '@/store/ui';
import { useT } from '@/i18n';
import { Markdown } from './Markdown';

function Reasoning({ text, ms, active }: { text: string; ms?: number; active: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(active);
  const wasActive = useRef(active);
  useEffect(() => {
    if (wasActive.current && !active) setOpen(false);
    if (active) setOpen(true);
    wasActive.current = active;
  }, [active]);
  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 -ml-2 text-xs font-medium text-fg-muted hover:bg-muted hover:text-fg"
      >
        <Brain className={cn('size-3.5', active && 'animate-pulse text-accent')} />
        {active ? t('msg.thinking') : ms ? t('msg.thoughtFor', { time: formatDuration(ms) }) : t('msg.thoughts')}
        <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="mt-1.5 max-h-[50vh] overflow-y-auto border-l-2 border-line pl-3.5 text-[0.88em] leading-relaxed text-fg-muted">
          <Markdown content={text} />
        </div>
      )}
    </div>
  );
}

function AttachmentView({ a, onOpen }: { a: Attachment; onOpen(a: Attachment): void }) {
  if (a.kind === 'image' && a.dataUrl) {
    return (
      <button type="button" onClick={() => onOpen(a)} className="overflow-hidden rounded-xl border border-line">
        <img src={a.dataUrl} alt={a.name} className="max-h-48 max-w-[14rem] object-cover" loading="lazy" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(a)}
      className="flex max-w-[16rem] items-center gap-2 rounded-xl border border-line bg-bg px-3 py-2 text-left hover:bg-muted"
    >
      {a.kind === 'pdf' ? <FileIcon className="size-5 shrink-0 text-danger" /> : <FileText className="size-5 shrink-0 text-accent" />}
      <span className="min-w-0">
        <span className="block truncate text-sm text-fg">{a.name}</span>
        <span className="block text-xs text-fg-subtle">{formatBytes(a.size)}</span>
      </span>
    </button>
  );
}

function AttachmentModal({ a, onClose }: { a: Attachment | null; onClose(): void }) {
  return (
    <Modal open={!!a} onClose={onClose} title={a?.name} size="lg" mobileFull bodyClassName="p-0">
      {a?.kind === 'image' && <img src={a.dataUrl} alt={a.name} className="mx-auto max-h-[80dvh]" />}
      {a?.kind === 'text' && <pre className="p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-fg">{a.text}</pre>}
      {a?.kind === 'pdf' && <iframe title={a.name} src={a.dataUrl} className="h-[80dvh] w-full" />}
    </Modal>
  );
}

function ActionButton({ title, onClick, children }: { title: string; onClick(): void; children: React.ReactNode }) {
  return (
    <IconButton size="sm" title={title} aria-label={title} onClick={onClick}>
      {children}
    </IconButton>
  );
}

function CopyAction({ text }: { text: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  return (
    <ActionButton
      title={t('common.copy')}
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }
      }}
    >
      {done ? <Check /> : <Copy />}
    </ActionButton>
  );
}

function formatTime(ts: number) {
  const d = new Date(ts);
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
}

function speak(text: string) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const plain = text.replace(/```[\s\S]*?```/g, ' ').replace(/[#*_`>|-]/g, ' ');
  const u = new SpeechSynthesisUtterance(plain);
  u.lang = /[一-鿿]/.test(plain) ? 'zh-CN' : 'en-US';
  window.speechSynthesis.speak(u);
}

function finishNotice(reason: string | undefined, t: ReturnType<typeof useT>) {
  if (!reason) return null;
  if (reason === 'length' || reason === 'max_tokens') return t('msg.truncated');
  if (reason === 'refusal') return t('msg.refusal');
  if (/content_filter|safety|blocklist|prohibited|recitation|spii/i.test(reason)) return t('msg.filtered', { reason });
  return null;
}

function UserMessage({ m }: { m: Message }) {
  const t = useT();
  const renderMd = useData((s) => s.settings.renderMarkdownForUser);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.content);
  const [viewing, setViewing] = useState<Attachment | null>(null);

  if (editing) {
    return (
      <div className="flex justify-end">
        <div className="w-full max-w-[85%] rounded-2xl border border-line bg-bg p-2 shadow-sm">
          <Textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(12, Math.max(3, draft.split('\n').length))}
            className="border-0 focus:ring-0"
          />
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void editMessage(m, draft, false);
                setEditing(false);
              }}
            >
              {t('common.save')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                void editMessage(m, draft, true);
                setEditing(false);
              }}
            >
              {t('msg.saveAndSend')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex flex-col items-end gap-1.5">
      {!!m.attachments?.length && (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-2">
          {m.attachments.map((a) => (
            <AttachmentView key={a.id} a={a} onOpen={setViewing} />
          ))}
        </div>
      )}
      {m.content && (
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-bubble px-4 py-2.5 text-fg" title={new Date(m.createdAt).toLocaleString()}>
          {renderMd ? <Markdown content={m.content} /> : <div className="leading-relaxed break-words whitespace-pre-wrap">{m.content}</div>}
        </div>
      )}
      <div className="flex items-center gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
        <CopyAction text={m.content} />
        <ActionButton
          title={t('common.edit')}
          onClick={() => {
            setDraft(m.content);
            setEditing(true);
          }}
        >
          <Pencil />
        </ActionButton>
        <ActionButton
          title={t('common.delete')}
          onClick={async () => {
            if (await confirmDialog({ title: t('msg.deleteConfirm'), danger: true, confirmText: t('common.delete') })) deleteMessage(m);
          }}
        >
          <Trash2 />
        </ActionButton>
      </div>
      <AttachmentModal a={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}

function AssistantMessage({ m, streaming, isLast }: { m: Message; streaming: boolean; isLast: boolean }) {
  const t = useT();
  const provider = useData((s) => (m.providerId ? s.providers[m.providerId] : undefined));
  const showUsage = useData((s) => s.settings.showUsage);
  const versions = m.versions?.length ?? 0;
  const vi = m.versionIndex ?? versions - 1;
  const notice = !streaming ? finishNotice(m.finishReason, t) : null;
  const reasoningActive = streaming && !m.content;
  const u = m.usage;

  return (
    <div className="group flex gap-3">
      <div className="hidden pt-0.5 sm:block">
        <ProviderAvatar provider={provider} name={m.providerName ?? m.model ?? 'AI'} size="md" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-center gap-2 text-xs text-fg-subtle">
          <span className="sm:hidden">
            <ProviderAvatar provider={provider} name={m.providerName ?? m.model ?? 'AI'} size="xs" />
          </span>
          <span className="truncate font-medium text-fg-muted">{m.model ?? 'AI'}</span>
          {m.providerName && <span className="truncate">· {m.providerName}</span>}
          <span className="shrink-0" title={new Date(m.createdAt).toLocaleString()}>
            · {formatTime(m.createdAt)}
          </span>
        </div>
        {m.reasoning && <Reasoning text={m.reasoning} ms={m.reasoningMs} active={reasoningActive} />}
        {m.content ? (
          <div className={cn(streaming && 'streaming-tail')}>
            <Markdown content={m.content} streaming={streaming} />
          </div>
        ) : streaming && !m.reasoning ? (
          <div className="typing-dots py-2 text-fg-subtle">
            <span />
            <span />
            <span />
          </div>
        ) : null}
        {m.status === 'error' && (
          <div className="mt-2 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm text-danger">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 flex-1 break-words">{m.error || t('msg.failed')}</div>
            <Button size="xs" variant="outline" className="border-danger/40 text-danger" onClick={() => retryLast(m.conversationId)} icon={<RefreshCw className="size-3" />}>
              {t('msg.retry')}
            </Button>
          </div>
        )}
        {m.status === 'aborted' && <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-fg-subtle"><Square className="size-3" />{t('msg.stopped')}</div>}
        {notice && (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-warning/10 px-2.5 py-1 text-xs text-warning">
            <AlertTriangle className="size-3.5" />
            {notice}
          </div>
        )}
        {!streaming && (
          <div
            className={cn(
              'mt-2 flex flex-wrap items-center gap-0.5 transition-opacity',
              isLast ? 'opacity-100' : 'opacity-100 md:opacity-0 md:group-hover:opacity-100',
            )}
          >
            {versions > 1 && (
              <div className="mr-1 flex items-center text-xs text-fg-muted">
                <IconButton size="sm" disabled={vi <= 0} onClick={() => switchVersion(m, vi - 1)} aria-label="previous">
                  <ChevronLeft />
                </IconButton>
                <span className="tabular-nums">
                  {vi + 1}/{versions}
                </span>
                <IconButton size="sm" disabled={vi >= versions - 1} onClick={() => switchVersion(m, vi + 1)} aria-label="next">
                  <ChevronRight />
                </IconButton>
              </div>
            )}
            <CopyAction text={m.content} />
            <ActionButton title={t('msg.regenerate')} onClick={() => regenerate(m)}>
              <RefreshCw />
            </ActionButton>
            <Dropdown
              align="start"
              width={190}
              trigger={({ ref, onClick }) => (
                <IconButton ref={ref} size="sm" onClick={onClick} aria-label={t('common.more')}>
                  <MoreHorizontal />
                </IconButton>
              )}
            >
              {(close) => (
                <>
                  <MenuItem
                    icon={<GitBranch />}
                    onClick={() => {
                      close();
                      forkConversation(m);
                      toast(t('msg.forked'), 'success');
                    }}
                  >
                    {t('msg.fork')}
                  </MenuItem>
                  <MenuItem
                    icon={<Volume2 />}
                    onClick={() => {
                      close();
                      speak(m.content);
                    }}
                  >
                    {t('msg.readAloud')}
                  </MenuItem>
                  <MenuDivider />
                  <MenuItem
                    danger
                    icon={<Trash2 />}
                    onClick={async () => {
                      close();
                      if (await confirmDialog({ title: t('msg.deleteConfirm'), danger: true, confirmText: t('common.delete') })) deleteMessage(m);
                    }}
                  >
                    {t('common.delete')}
                  </MenuItem>
                </>
              )}
            </Dropdown>
            {showUsage && (
              <div className="ml-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-fg-subtle tabular-nums">
                {u?.input !== undefined && <span title={t('msg.inputTokens')}>↑ {formatNumber(u.input)}</span>}
                {u?.output !== undefined && <span title={t('msg.outputTokens')}>↓ {formatNumber(u.output)}</span>}
                {m.durationMs !== undefined && <span>{formatDuration(m.durationMs)}</span>}
                {m.firstTokenMs !== undefined && m.firstTokenMs > 0 && <span title={t('msg.firstToken')}>TTFT {formatDuration(m.firstTokenMs)}</span>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MessageItemImpl({ m, streaming, isLast }: { m: Message; streaming: boolean; isLast: boolean }) {
  return m.role === 'user' ? <UserMessage m={m} /> : <AssistantMessage m={m} streaming={streaming} isLast={isLast} />;
}

export const MessageItem = memo(MessageItemImpl);
