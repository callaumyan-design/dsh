import { BookmarkPlus, X } from 'lucide-react';
import { Button, Field, IconButton, Select, Textarea } from '@/components/ui/primitives';
import { updateConversation, updateSettings, useData } from '@/store/data';
import { toast, useUI } from '@/store/ui';
import { useT } from '@/i18n';
import { ParamsEditor } from './ParamsEditor';

export function ChatSettingsPanel({ conversationId }: { conversationId: string }) {
  const t = useT();
  const conv = useData((s) => s.conversations[conversationId]);
  const prompts = useData((s) => s.prompts);
  if (!conv) return null;
  const close = () => useUI.setState({ chatSettingsOpen: false });
  const list = Object.values(prompts).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt - b.createdAt);

  return (
    <>
      <div className="anim-fade fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={close} />
      <aside className="anim-up fixed inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col border-l border-line bg-bg shadow-pop lg:static lg:z-auto lg:w-80 lg:shadow-none">
        <div className="safe-top flex items-center justify-between border-b border-line px-4 py-3">
          <h3 className="text-sm font-semibold">{t('chatSettings.title')}</h3>
          <IconButton size="sm" onClick={close} aria-label={t('common.close')}>
            <X />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
          <Field
            label={t('chatSettings.system')}
            hint={t('chatSettings.systemHint')}
            action={
              list.length > 0 && (
                <Select
                  className="h-7 w-auto rounded-lg py-0 pr-7 pl-2 text-xs"
                  value=""
                  onChange={(e) => {
                    const p = prompts[e.target.value];
                    if (p) updateConversation(conv.id, { systemPrompt: p.systemPrompt, promptId: p.id });
                  }}
                >
                  <option value="">{t('chatSettings.fromLibrary')}</option>
                  {list.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.icon ? `${p.icon} ` : ''}
                      {p.name}
                    </option>
                  ))}
                </Select>
              )
            }
          >
            <Textarea
              rows={6}
              value={conv.systemPrompt ?? ''}
              placeholder={t('chatSettings.systemPlaceholder')}
              onChange={(e) => updateConversation(conv.id, { systemPrompt: e.target.value })}
            />
          </Field>
          <ParamsEditor value={conv.params ?? {}} onChange={(params) => updateConversation(conv.id, { params })} />
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            icon={<BookmarkPlus className="size-4" />}
            onClick={() => {
              updateSettings({ defaultParams: conv.params, defaultSystemPrompt: conv.systemPrompt || undefined });
              toast(t('chatSettings.savedDefault'), 'success');
            }}
          >
            {t('chatSettings.saveDefault')}
          </Button>
        </div>
      </aside>
    </>
  );
}
