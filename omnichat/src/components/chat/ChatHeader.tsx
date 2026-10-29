import { Download, Eraser, FileJson, FolderInput, MoreHorizontal, PanelLeft, Pencil, Pin, PinOff, SlidersHorizontal, SquarePen, Trash2, Sparkles } from 'lucide-react';
import { Dropdown, IconButton, MenuDivider, MenuItem } from '@/components/ui/primitives';
import { exportConversationJson, exportConversationMarkdown } from '@/lib/export';
import { autoTitle, clearConversation } from '@/store/chat';
import { getMessages, removeConversation, updateConversation, useData } from '@/store/data';
import { confirmDialog, openConversation, openProject, promptDialog, useUI } from '@/store/ui';
import { ProjectIcon } from '@/components/project/ProjectDialogs';
import { useT } from '@/i18n';

export function ChatHeader({ conversationId }: { conversationId: string | null }) {
  const t = useT();
  const sidebarOpen = useUI((s) => s.sidebarOpen);
  const chatSettingsOpen = useUI((s) => s.chatSettingsOpen);
  const conv = useData((s) => (conversationId ? s.conversations[conversationId] : undefined));
  const project = useData((s) => (conv?.projectId ? s.projects[conv.projectId] : undefined));
  const labels = { user: t('role.user'), assistant: t('role.assistant'), system: t('role.system') };

  return (
    <header className="safe-top flex h-14 shrink-0 items-center gap-1 border-b border-transparent px-2 sm:px-3">
      <IconButton aria-label={t('sidebar.toggle')} onClick={() => useUI.setState({ sidebarOpen: true })} className={sidebarOpen ? 'md:hidden' : ''}>
        <PanelLeft />
      </IconButton>
      <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5 px-2 text-sm text-fg-muted">
        {project && (
          <>
            <button
              type="button"
              onClick={() => openProject(project.id)}
              className="flex min-w-0 shrink items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-muted hover:text-fg"
              title={project.name}
            >
              <ProjectIcon icon={project.icon} className="size-4" />
              <span className="max-w-[40vw] truncate lg:max-w-56">{project.name}</span>
            </button>
            <span className="hidden text-fg-subtle lg:inline">/</span>
          </>
        )}
        {conv && <div className="hidden min-w-0 truncate lg:block">{conv.title}</div>}
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
                <MenuItem
                  icon={<FolderInput />}
                  onClick={() => {
                    close();
                    useUI.setState({ moveConversationId: conv.id });
                  }}
                >
                  {t('project.moveTo')}
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
