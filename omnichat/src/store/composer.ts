import { create } from 'zustand';
import { t } from '@/i18n';
import { compressImage, formatBytes, isTextFile, readFileAsDataURL, readFileAsText, uid } from '@/lib/utils';
import type { Attachment } from '@/lib/types';
import { toast, useUI } from './ui';

interface Draft {
  text: string;
  attachments: Attachment[];
}

interface ComposerState {
  drafts: Record<string, Draft>;
  busy: boolean;
}

export const useComposer = create<ComposerState>(() => ({ drafts: {}, busy: false }));

export const draftKey = (activeId: string | null) => activeId ?? 'new';
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

export async function fileToAttachment(file: File): Promise<Attachment | null> {
  const name = file.name || 'file';
  if (file.type.startsWith('image/')) {
    if (file.size > MAX_IMAGE) throw new Error(t('composer.tooLarge', { name, size: formatBytes(MAX_IMAGE) }));
    const img = await compressImage(file);
    return { id: uid(), kind: 'image', name, mime: img.mime, size: img.size, dataUrl: img.dataUrl };
  }
  if (file.type === 'application/pdf' || /\.pdf$/i.test(name)) {
    if (file.size > MAX_PDF) throw new Error(t('composer.tooLarge', { name, size: formatBytes(MAX_PDF) }));
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
  const key = draftKey(useUI.getState().activeId);
  const list = Array.from(files);
  if (!list.length) return;
  useComposer.setState({ busy: true });
  try {
    for (const f of list) {
      try {
        const a = await fileToAttachment(f);
        if (a) setDraft(key, { attachments: [...getDraft(key).attachments, a] });
      } catch (err) {
        toast((err as Error).message, 'error');
      }
    }
  } finally {
    useComposer.setState({ busy: false });
  }
}
