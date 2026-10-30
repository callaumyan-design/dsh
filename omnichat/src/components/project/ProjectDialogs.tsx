import { useEffect, useState } from 'react';
import { Check, Folder, FolderMinus, FolderPlus } from 'lucide-react';
import { Button, Field, Input, Modal, Textarea } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { updateProject, useData } from '@/store/data';
import { createProject, moveToProject, sortedProjects } from '@/store/projects';
import { openProject, useUI } from '@/store/ui';
import { useT } from '@/i18n';

export function ProjectIcon({ icon, className }: { icon?: string; className?: string }) {
  return icon ? <span className={cn('inline-flex shrink-0 items-center justify-center leading-none', className)}>{icon}</span> : <Folder className={cn('shrink-0', className)} />;
}

/** Creates a project ('new') or edits one; a new project also takes the chat being moved, if any. */
function ProjectEditor() {
  const t = useT();
  const editing = useUI((s) => s.projectEditor);
  const project = useData((s) => (editing && editing !== 'new' ? s.projects[editing] : undefined));
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');

  useEffect(() => {
    if (!editing) return;
    setName(project?.name ?? '');
    setIcon(project?.icon ?? '');
    setDescription(project?.description ?? '');
    setInstructions(project?.instructions ?? '');
    // Load the stored values when the dialog opens, not on every remote update while typing.
  }, [editing]);

  const close = () => useUI.setState({ projectEditor: null });
  const save = () => {
    if (!name.trim()) return;
    const data = {
      name: name.trim(),
      icon: icon.trim() || undefined,
      description: description.trim() || undefined,
      instructions: instructions.trim() || undefined,
    };
    if (project) {
      updateProject(project.id, data);
      close();
      return;
    }
    const p = createProject(data);
    const moving = useUI.getState().moveConversationId;
    useUI.setState({ projectEditor: null, moveConversationId: null });
    if (moving) moveToProject(moving, p.id);
    else openProject(p.id);
  };

  return (
    <Modal
      open={!!editing}
      onClose={close}
      size="md"
      title={project ? t('project.edit') : t('project.new')}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" variant="primary" disabled={!name.trim()} onClick={save}>
            {project ? t('common.save') : t('project.create')}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="flex gap-3">
          <Field label={t('project.icon')} className="w-20 shrink-0">
            <Input value={icon} maxLength={8} placeholder="📁" aria-label={t('project.icon')} title={t('project.iconHint')} onChange={(e) => setIcon(e.target.value)} className="text-center text-lg" />
          </Field>
          <Field label={t('project.name')} className="min-w-0 flex-1">
            <Input value={name} autoFocus maxLength={80} placeholder={t('project.namePlaceholder')} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <Field label={t('project.description')}>
          <Input value={description} maxLength={200} placeholder={t('project.descriptionPlaceholder')} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label={t('project.instructions')} hint={t('project.instructionsHint')}>
          <Textarea rows={8} value={instructions} placeholder={t('project.instructionsPlaceholder')} onChange={(e) => setInstructions(e.target.value)} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function MoveToProject() {
  const t = useT();
  const id = useUI((s) => s.moveConversationId);
  const editorOpen = useUI((s) => !!s.projectEditor);
  const conv = useData((s) => (id ? s.conversations[id] : undefined));
  const projectsMap = useData((s) => s.projects);
  const conversations = useData((s) => s.conversations);
  const projects = sortedProjects(projectsMap, conversations);
  const close = () => useUI.setState({ moveConversationId: null });
  const pick = (projectId: string | undefined) => {
    if (id) moveToProject(id, projectId);
    close();
  };

  return (
    <Modal open={!!conv && !editorOpen} onClose={close} size="sm" title={t('project.moveTitle')} bodyClassName="p-2">
      <div className="space-y-0.5">
        {projects.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => pick(p.id)}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm text-fg hover:bg-muted"
          >
            <ProjectIcon icon={p.icon} className="size-4 text-fg-muted" />
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            {conv?.projectId === p.id && <Check className="size-4 text-accent" />}
          </button>
        ))}
        <button
          type="button"
          onClick={() => useUI.setState({ projectEditor: 'new' })}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm text-fg-muted hover:bg-muted hover:text-fg"
        >
          <FolderPlus className="size-4" />
          {t('project.new')}
        </button>
        {conv?.projectId && projectsMap[conv.projectId] && (
          <>
            <div className="my-1 h-px bg-line" />
            <button
              type="button"
              onClick={() => pick(undefined)}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm text-fg-muted hover:bg-muted hover:text-fg"
            >
              <FolderMinus className="size-4" />
              {t('project.removeFrom')}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

export function ProjectDialogs() {
  return (
    <>
      <ProjectEditor />
      <MoveToProject />
    </>
  );
}
