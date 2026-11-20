// Projects: groups of chats that share instructions and reference files.
import { t } from '@/i18n';
import { formatBytes, uid } from '@/lib/utils';
import type { Conversation, Project } from '@/lib/types';
import { attachmentsBytes, fileToAttachment, syncedLimit } from './composer';
import { removeProject, saveProject, updateConversation, updateProject, useData } from './data';
import { confirmDialog, openConversation, toast, useUI } from './ui';

export function sortedProjects(projects: Record<string, Project>, conversations: Record<string, Conversation>): Project[] {
  const recent = new Map<string, number>();
  for (const c of Object.values(conversations)) {
    if (!c.projectId) continue;
    const ts = c.lastMessageAt ?? c.createdAt;
    if (ts > (recent.get(c.projectId) ?? 0)) recent.set(c.projectId, ts);
  }
  const ts = (p: Project) => Math.max(recent.get(p.id) ?? 0, p.createdAt);
  return Object.values(projects).sort((a, b) => ts(b) - ts(a));
}

export function projectConversations(projectId: string, conversations: Record<string, Conversation>): Conversation[] {
  return Object.values(conversations)
    .filter((c) => c.projectId === projectId)
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt));
}

export function createProject(data: Omit<Project, 'id' | 'createdAt'>): Project {
  const p: Project = { ...data, id: uid(), createdAt: Date.now() };
  saveProject(p);
  return p;
}

/** Reads files into the project's knowledge, keeping the whole project inside one synced record. */
export async function addProjectFiles(projectId: string, files: File[] | FileList) {
  for (const f of Array.from(files)) {
    const project = useData.getState().projects[projectId];
    if (!project) return;
    try {
      const a = await fileToAttachment(f);
      if (!a) continue;
      const current = useData.getState().projects[projectId]?.files ?? [];
      const next = [...current, a];
      if (attachmentsBytes(next) + (project.instructions?.length ?? 0) * 3 > syncedLimit()) {
        toast(t('project.filesTooLarge', { size: formatBytes(syncedLimit()) }), 'error');
        continue;
      }
      updateProject(projectId, { files: next });
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }
}

export function removeProjectFile(projectId: string, fileId: string) {
  const files = useData.getState().projects[projectId]?.files ?? [];
  updateProject(projectId, { files: files.filter((f) => f.id !== fileId) });
}

export function moveToProject(conversationId: string, projectId: string | undefined) {
  updateConversation(conversationId, { projectId });
  const project = projectId ? useData.getState().projects[projectId] : undefined;
  toast(project ? t('project.moved', { name: project.name }) : t('project.removed'), 'success');
}

/** Asks first, then deletes the project and every chat in it. */
export async function deleteProject(id: string) {
  const { projects, conversations } = useData.getState();
  const p = projects[id];
  if (!p) return;
  const count = projectConversations(id, conversations).length;
  const ok = await confirmDialog({
    title: t('project.deleteConfirm'),
    message: t('project.deleteMessage', { name: p.name, count }),
    danger: true,
    confirmText: t('common.delete'),
  });
  if (!ok) return;
  const ui = useUI.getState();
  const activeInProject = ui.activeId && useData.getState().conversations[ui.activeId]?.projectId === id;
  removeProject(id);
  if (ui.projectId === id || activeInProject) openConversation(null);
}
