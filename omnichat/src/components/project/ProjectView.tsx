import { useEffect, useMemo, useRef, useState } from 'react';
import { File as FileIcon, FileText, Loader2, MessageSquare, MoreHorizontal, Pencil, Pin, Plus, Trash2, X } from 'lucide-react';
import { Composer } from '@/components/chat/Composer';
import { Dropdown, IconButton, MenuDivider, MenuItem } from '@/components/ui/primitives';
import { formatBytes } from '@/lib/utils';
import { useData } from '@/store/data';
import { addProjectFiles, deleteProject, projectConversations, removeProjectFile } from '@/store/projects';
import { openConversation, toast, useUI } from '@/store/ui';
import { useLang, useT } from '@/i18n';
import { ProjectIcon } from './ProjectDialogs';

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col rounded-2xl border border-line bg-soft p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function ProjectView({ projectId }: { projectId: string }) {
  const t = useT();
  const lang = useLang();
  const project = useData((s) => s.projects[projectId]);
  const conversationsMap = useData((s) => s.conversations);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const chats = useMemo(() => projectConversations(projectId, conversationsMap), [projectId, conversationsMap]);
  const dateFmt = useMemo(() => new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' }), [lang]);

  // A project link that no longer exists (deleted elsewhere) falls back to a new chat.
  useEffect(() => {
    if (project) return;
    const timer = setTimeout(() => {
      if (!useData.getState().projects[projectId] && useUI.getState().projectId === projectId) {
        toast(t('project.notFound'));
        openConversation(null);
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [project, projectId, t]);

  if (!project) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-fg-subtle" />
      </div>
    );
  }

  const edit = () => useUI.setState({ projectEditor: project.id });
  const upload = async (files: FileList) => {
    setUploading(true);
    try {
      await addProjectFiles(project.id, files);
    } finally {
      setUploading(false);
    }
  };
  const files = project.files ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
        <div className="mb-6 flex items-start gap-3 px-3">
          <ProjectIcon icon={project.icon} className="mt-0.5 size-8 text-2xl text-fg-muted" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-semibold tracking-tight text-fg">{project.name}</h1>
            {project.description && <p className="mt-1 text-sm text-fg-muted">{project.description}</p>}
          </div>
          <Dropdown
            width={180}
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
                  onClick={() => {
                    close();
                    edit();
                  }}
                >
                  {t('project.edit')}
                </MenuItem>
                <MenuDivider />
                <MenuItem
                  danger
                  icon={<Trash2 />}
                  onClick={() => {
                    close();
                    void deleteProject(project.id);
                  }}
                >
                  {t('project.delete')}
                </MenuItem>
              </>
            )}
          </Dropdown>
        </div>

        <Composer compact />

        <div className="mt-6 grid gap-3 px-3 sm:grid-cols-2">
          <Card
            title={t('project.instructions')}
            action={
              <IconButton size="sm" onClick={edit} aria-label={t('common.edit')} title={t('common.edit')}>
                <Pencil />
              </IconButton>
            }
          >
            <button type="button" onClick={edit} className="text-left">
              {project.instructions ? (
                <p className="line-clamp-5 text-sm whitespace-pre-wrap text-fg-muted">{project.instructions}</p>
              ) : (
                <p className="text-sm text-fg-subtle">{t('project.instructionsEmpty')}</p>
              )}
            </button>
          </Card>

          <Card
            title={t('project.files')}
            action={
              <IconButton
                size="sm"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                aria-label={t('project.addFiles')}
                title={t('project.addFiles')}
              >
                {uploading ? <Loader2 className="animate-spin" /> : <Plus />}
              </IconButton>
            }
          >
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) void upload(e.target.files);
                e.target.value = '';
              }}
            />
            {files.length > 0 ? (
              <ul className="space-y-1">
                {files.map((f) => (
                  <li key={f.id} className="group flex items-center gap-2 rounded-lg py-1 pr-1 text-sm">
                    {f.kind === 'image' ? (
                      <img src={f.dataUrl} alt="" className="size-7 shrink-0 rounded-md border border-line object-cover" />
                    ) : f.kind === 'pdf' ? (
                      <FileIcon className="size-5 shrink-0 text-danger" />
                    ) : (
                      <FileText className="size-5 shrink-0 text-accent" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-fg" title={f.name}>
                      {f.name}
                    </span>
                    <span className="shrink-0 text-xs text-fg-subtle">{formatBytes(f.size)}</span>
                    <button
                      type="button"
                      aria-label={t('common.remove')}
                      title={t('common.remove')}
                      onClick={() => removeProjectFile(project.id, f.id)}
                      className="flex size-6 shrink-0 items-center justify-center rounded-md text-fg-subtle hover:bg-line hover:text-fg md:opacity-0 md:group-hover:opacity-100"
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="rounded-xl border border-dashed border-line-strong px-3 py-4 text-sm text-fg-subtle hover:bg-muted hover:text-fg"
              >
                {t('project.filesEmpty')} · {t('project.addFiles')}
              </button>
            )}
            <p className="mt-2 text-xs leading-relaxed text-fg-subtle">{t('project.filesHint')}</p>
          </Card>
        </div>

        <div className="mt-8 px-3">
          <h2 className="mb-2 text-sm font-semibold text-fg">{t('project.chats')}</h2>
          {chats.length ? (
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {chats.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => openConversation(c.id)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-soft"
                  >
                    <MessageSquare className="size-4 shrink-0 text-fg-subtle" />
                    <span className="min-w-0 flex-1 truncate text-sm text-fg">{c.title || t('chat.newChat')}</span>
                    {c.pinned && <Pin className="size-3.5 shrink-0 text-fg-subtle" />}
                    <span className="shrink-0 text-xs text-fg-subtle">{dateFmt.format(c.lastMessageAt ?? c.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-fg-subtle">{t('project.noChats')}</p>
          )}
        </div>
      </div>
    </div>
  );
}
