import { useMemo, useState } from 'react';
import { Library, MessageSquarePlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button, Field, IconButton, Input, Modal, Textarea } from '@/components/ui/primitives';
import { ModelPicker } from '@/components/chat/ModelPicker';
import { BUILTIN_PROMPTS, localizedBuiltin } from '@/lib/builtinPrompts';
import { uid } from '@/lib/utils';
import type { Prompt } from '@/lib/types';
import { removePrompt, savePrompt, useData } from '@/store/data';
import { confirmDialog, openConversation, toast, useUI } from '@/store/ui';
import { useLang, useT } from '@/i18n';

function PromptEditor({ prompt, onClose }: { prompt: Prompt | null; onClose(): void }) {
  const t = useT();
  const [draft, setDraft] = useState<Prompt | null>(prompt);
  if (prompt && draft?.id !== prompt.id) setDraft(prompt);
  const p = draft;
  return (
    <Modal
      open={!!prompt}
      onClose={onClose}
      title={prompt && useData.getState().prompts[prompt.id] ? t('prompts.edit') : t('prompts.new')}
      size="md"
      mobileFull
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!p?.name.trim() || !p?.systemPrompt.trim()}
            onClick={() => {
              if (p) savePrompt({ ...p, name: p.name.trim() });
              onClose();
            }}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      {p && (
        <div className="space-y-4">
          <div className="flex gap-3">
            <Field label={t('prompts.icon')} className="w-20">
              <Input value={p.icon ?? ''} maxLength={4} onChange={(e) => setDraft({ ...p, icon: e.target.value })} className="text-center text-lg" placeholder="✨" />
            </Field>
            <Field label={t('prompts.name')} className="flex-1">
              <Input value={p.name} onChange={(e) => setDraft({ ...p, name: e.target.value })} autoFocus />
            </Field>
          </div>
          <Field label={t('prompts.description')}>
            <Input value={p.description ?? ''} onChange={(e) => setDraft({ ...p, description: e.target.value })} />
          </Field>
          <Field label={t('prompts.system')}>
            <Textarea rows={8} value={p.systemPrompt} onChange={(e) => setDraft({ ...p, systemPrompt: e.target.value })} />
          </Field>
          <Field label={t('prompts.model')} hint={t('prompts.modelHint')}>
            <ModelPicker
              variant="field"
              allowEmpty
              emptyLabel={t('prompts.noModel')}
              value={{ providerId: p.providerId, model: p.model }}
              onChange={(v) => setDraft({ ...p, providerId: v.providerId, model: v.model })}
            />
          </Field>
        </div>
      )}
    </Modal>
  );
}

export function PromptsTab({ onUse }: { onUse?(): void }) {
  const t = useT();
  const lang = useLang();
  const promptsMap = useData((s) => s.prompts);
  const prompts = useMemo(() => Object.values(promptsMap).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt - b.createdAt), [promptsMap]);
  const [editing, setEditing] = useState<Prompt | null>(null);

  const importBuiltins = () => {
    const names = new Set(prompts.map((p) => p.name));
    let n = 0;
    for (const b of BUILTIN_PROMPTS) {
      const l = localizedBuiltin(b, lang);
      if (names.has(l.name)) continue;
      savePrompt({ id: uid(), ...l, createdAt: Date.now() + n, order: prompts.length + n });
      n++;
    }
    toast(t('prompts.imported', { n }), 'success');
  };

  const use = (p: Prompt) => {
    useUI.setState({
      draft: { promptId: p.id, systemPrompt: p.systemPrompt, ...(p.providerId && p.model ? { providerId: p.providerId, model: p.model } : {}) },
      settingsOpen: false,
    });
    openConversation(null);
    onUse?.();
  };

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-sm text-fg-muted">{t('prompts.desc')}</p>
        <Button size="sm" variant="outline" icon={<Library className="size-4" />} onClick={importBuiltins}>
          {t('prompts.importBuiltin')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          icon={<Plus className="size-4" />}
          onClick={() => setEditing({ id: uid(), name: '', systemPrompt: '', icon: '', createdAt: Date.now(), order: prompts.length })}
        >
          {t('prompts.new')}
        </Button>
      </div>
      {prompts.length === 0 && <div className="rounded-xl border border-dashed border-line py-10 text-center text-sm text-fg-subtle">{t('prompts.empty')}</div>}
      <div className="grid gap-3 sm:grid-cols-2">
        {prompts.map((p) => (
          <div key={p.id} className="group flex flex-col rounded-xl border border-line p-3.5 transition-colors hover:border-line-strong">
            <div className="flex items-start gap-2.5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-lg">{p.icon || '✨'}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{p.name}</div>
                <div className="line-clamp-2 text-xs text-fg-subtle">{p.description || p.systemPrompt}</div>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-1">
              <Button size="xs" variant="secondary" icon={<MessageSquarePlus className="size-3.5" />} onClick={() => use(p)}>
                {t('prompts.use')}
              </Button>
              <div className="ml-auto flex">
                <IconButton size="sm" aria-label={t('common.edit')} onClick={() => setEditing(p)}>
                  <Pencil />
                </IconButton>
                <IconButton
                  size="sm"
                  aria-label={t('common.delete')}
                  onClick={async () => {
                    if (await confirmDialog({ title: t('prompts.deleteConfirm', { name: p.name }), danger: true, confirmText: t('common.delete') })) removePrompt(p.id);
                  }}
                >
                  <Trash2 />
                </IconButton>
              </div>
            </div>
          </div>
        ))}
      </div>
      <PromptEditor prompt={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
