import { create } from 'zustand';
import { t } from '@/i18n';
import { compressImage, formatBytes, isTextFile, readFileAsDataURL, readFileAsText, uid } from '@/lib/utils';
import type { Attachment } from '@/lib/types';
import { getSyncLimits } from '@/lib/sync';
import { toast, useUI } from './ui';
import type { ModelRef } from './chat';

interface Draft {
  text: string;
  attachments: Attachment[];
  /** Extra models that answer each message alongside the conversation's model. */
  compare?: ModelRef[];
}

interface ComposerState {
  drafts: Record<string, Draft>;
  busy: boolean;
}

export const useComposer = create<ComposerState>(() => ({ drafts: {}, busy: false }));

/** Each chat keeps its own draft; so do the new-chat screen and each project's page. */
export const draftKey = (activeId: string | null, projectId?: string | null) => activeId ?? (projectId ? `project:${projectId}` : 'new');
const EMPTY: Draft = { text: '', attachments: [] };

export function getDraft(key: string): Draft {
  return useComposer.getState().drafts[key] ?? EMPTY;
}

export function setDraft(key: string, patch: Partial<Draft>) {
  useComposer.setState((s) => ({ drafts: { ...s.drafts, [key]: { ...(s.drafts[key] ?? EMPTY), ...patch } } }));
}

export function clearDraft(key: string) {
  useComposer.setState((s) => {
    const drafts = { ...s.drafts };
    delete drafts[key];
    return { drafts };
  });
}

const MAX_IMAGE = 20 * 1024 * 1024;
const MAX_PDF = 20 * 1024 * 1024;
const MAX_TEXT = 2 * 1024 * 1024;

/** Encoded size of a message's attachments; it must fit in one synced record. */
export function attachmentsBytes(list: Attachment[]) {
  return list.reduce((n, a) => n + (a.dataUrl?.length ?? 0) + (a.text?.length ?? 0) * 3, 0);
}

export function syncedLimit() {
  return Math.floor(getSyncLimits().maxRecordBytes * 0.95);
}

export async function fileToAttachment(file: File): Promise<Attachment | null> {
  const name = file.name || 'file';
  if (file.type.startsWith('image/')) {
    if (file.size > MAX_IMAGE) throw new Error(t('composer.tooLarge', { name, size: formatBytes(MAX_IMAGE) }));
    let img = await compressImage(file);
    // Keep each image comfortably inside the deployment's per-message sync limit.
    for (const [side, q] of [[1600, 0.82], [1280, 0.75], [1024, 0.7]] as const) {
      if (img.dataUrl.length <= syncedLimit() * 0.6) break;
      img = await compressImage(file, side, q, true);
    }
    return { id: uid(), kind: 'image', name, mime: img.mime, size: img.size, dataUrl: img.dataUrl };
  }
  if (file.type === 'application/pdf' || /\.pdf$/i.test(name)) {
    const max = Math.min(MAX_PDF, Math.floor((syncedLimit() * 3) / 4));
    if (file.size > max) throw new Error(t('composer.tooLarge', { name, size: formatBytes(max) }));
    return { id: uid(), kind: 'pdf', name, mime: 'application/pdf', size: file.size, dataUrl: await readFileAsDataURL(file) };
  }
  if (isTextFile(file)) {
    if (file.size > MAX_TEXT) throw new Error(t('composer.tooLarge', { name, size: formatBytes(MAX_TEXT) }));
    return { id: uid(), kind: 'text', name, mime: file.type || 'text/plain', size: file.size, text: await readFileAsText(file) };
  }
  throw new Error(t('composer.unsupported', { name }));
}

/** Adds files to the draft of the active conversation. */
export async function addFiles(files: File[] | FileList) {
  const { activeId, projectId } = useUI.getState();
  const key = draftKey(activeId, projectId);
  const list = Array.from(files);
  if (!list.length) return;
  useComposer.setState({ busy: true });
  try {
    for (const f of list) {
      try {
        const a = await fileToAttachment(f);
        if (!a) continue;
        const next = [...getDraft(key).attachments, a];
        if (attachmentsBytes(next) > syncedLimit()) {
          toast(t('composer.totalTooLarge', { size: formatBytes(syncedLimit()) }), 'error');
          continue;
        }
        setDraft(key, { attachments: next });
      } catch (err) {
        toast((err as Error).message, 'error');
      }
    }
  } finally {
    useComposer.setState({ busy: false });
  }
}
