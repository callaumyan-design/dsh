import { Download, Eraser, FileJson, MoreHorizontal, PanelLeft, Pencil, Pin, PinOff, SlidersHorizontal, SquarePen, Trash2, Sparkles } from 'lucide-react';
import { Dropdown, IconButton, MenuDivider, MenuItem } from '@/components/ui/primitives';
import { exportConversationJson, exportConversationMarkdown } from '@/lib/export';
import { autoTitle, clearConversation, resolveTarget } from '@/store/chat';
import { getMessages, removeConversation, updateConversation, useData } from '@/store/data';
import { confirmDialog, openConversation, promptDialog, useUI } from '@/store/ui';
import { useT } from '@/i18n';
import { ModelPicker } from './ModelPicker';

export function ChatHeader({ conversationId }: { conversationId: string | null }) {
  const t = useT();
  const sidebarOpen = useUI((s) => s.sidebarOpen);
  const chatSettingsOpen = useUI((s) => s.chatSettingsOpen);
  const draft = useUI((s) => s.draft);
  const conv = useData((s) => (conversationId ? s.conversations[conversationId] : undefined));
  // Re-render when providers or the default model change so the fallback below stays current.
  useData((s) => s.providers);
  useData((s) => s.settings.defaultModel);
  const fallback = !conv && !draft.model ? resolveTarget() : null;
  const value = conv
    ? { providerId: conv.providerId, model: conv.model }
    : fallback
      ? { providerId: fallback.provider.id, model: fallback.model }
      : { providerId: draft.providerId, model: draft.model };

  const labels = { user: t('role.user'), assistant: t('role.assistant'), system: t('role.system') };

  return (
    <header className="safe-top flex h-14 shrink-0 items-center gap-1 border-b border-transparent px-2 sm:px-3">
      <IconButton aria-label={t('sidebar.toggle')} onClick={() => useUI.setState({ sidebarOpen: true })} className={sidebarOpen ? 'md:hidden' : ''}>
        <PanelLeft />
      </IconButton>
      <ModelPicker
        value={value}
        onChange={(v) => {
          if (conv) updateConversation(conv.id, { providerId: v.providerId, model: v.model });
          else useUI.setState({ draft: { ...draft, providerId: v.providerId, model: v.model } });
        }}
      />
      <div className="min-w-0 flex-1 px-2 text-center">
        {conv && <div className="hidden truncate text-sm text-fg-muted lg:block">{conv.title}</div>}
      </div>
      {conv ? (
        <>
          <IconButton
            title={t('chatSettings.title')}
            aria-label={t('chatSettings.title')}
            active={chatSettingsOpen}
            onClick={() => useUI.setState({ chatSettingsOpen: !chatSettingsOpen })}
          >
            <SlidersHorizontal />
          </IconButton>
          <Dropdown
            width={220}
            trigger={({ ref, onClick }) => (
              <IconButton ref={ref} onClick={onClick} aria-label={t('common.more')}>
                <MoreHorizontal />
              </IconButton>
            )}
          >
            {(close) => (
              <>
                <MenuItem
                  icon={<Pencil />}
                  onClick={async () => {
                    close();
                    const title = await promptDialog({ title: t('chat.rename'), value: conv.title });
                    if (title?.trim()) updateConversation(conv.id, { title: title.trim(), titleGenerated: true });
                  }}
                >
                  {t('chat.rename')}
                </MenuItem>
                <MenuItem
                  icon={<Sparkles />}
                  onClick={() => {
                    close();
                    void autoTitle(conv.id, true);
                  }}
                >
                  {t('chat.autoTitle')}
                </MenuItem>
                <MenuItem
                  icon={conv.pinned ? <PinOff /> : <Pin />}
                  onClick={() => {
                    close();
                    updateConversation(conv.id, { pinned: !conv.pinned });
                  }}
                >
                  {conv.pinned ? t('chat.unpin') : t('chat.pin')}
                </MenuItem>
                <MenuDivider />
                <MenuItem
                  icon={<Download />}
                  onClick={() => {
                    close();
                    exportConversationMarkdown(conv, getMessages(conv.id), labels);
                  }}
                >
                  {t('chat.exportMd')}
                </MenuItem>
                <MenuItem
                  icon={<FileJson />}
                  onClick={() => {
                    close();
                    exportConversationJson(conv, getMessages(conv.id));
                  }}
                >
                  {t('chat.exportJson')}
                </MenuItem>
                <MenuDivider />
                <MenuItem
                  icon={<Eraser />}
                  onClick={async () => {
                    close();
                    if (await confirmDialog({ title: t('chat.clearConfirm'), danger: true, confirmText: t('chat.clear') })) clearConversation(conv.id);
                  }}
                >
                  {t('chat.clear')}
                </MenuItem>
                <MenuItem
                  danger
                  icon={<Trash2 />}
                  onClick={async () => {
                    close();
                    if (await confirmDialog({ title: t('chat.deleteConfirm'), message: conv.title, danger: true, confirmText: t('common.delete') })) {
                      removeConversation(conv.id);
                      openConversation(null);
                    }
                  }}
                >
                  {t('chat.delete')}
                </MenuItem>
              </>
            )}
          </Dropdown>
        </>
      ) : null}
      <IconButton className="md:hidden" aria-label={t('chat.newChat')} onClick={() => openConversation(null)}>
        <SquarePen />
      </IconButton>
    </header>
  );
}
