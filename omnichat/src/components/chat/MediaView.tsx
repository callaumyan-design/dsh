// Images and videos a model generated: a gallery under the reply, a full-size viewer, and a card while generating.
import { useEffect, useState } from 'react';
import { AlertTriangle, Clapperboard, Download, ImageIcon, ImagePlus, Link2, Loader2, Maximize2 } from 'lucide-react';
import { IconButton, Modal } from '@/components/ui/primitives';
import { fetchStoredMedia } from '@/lib/ai/browser-media';
import { aspectValue, extOf } from '@/lib/ai/media';
import { cn } from '@/lib/utils';
import type { GeneratedMedia, GenProgress } from '@/lib/types';
import { addFiles } from '@/store/composer';
import { toast } from '@/store/ui';
import { useT } from '@/i18n';

// Stored files need the session token, so they are fetched once and shown from blob: URLs.
const blobUrls = new Map<string, Promise<string>>();

function srcOf(m: GeneratedMedia): string | Promise<string> {
  if (m.dataUrl) return m.dataUrl;
  if (!m.url) return '';
  if (!m.url.startsWith('/api/media/')) return m.url;
  let p = blobUrls.get(m.url);
  if (!p) {
    p = fetchStoredMedia(m.url).then((b) => URL.createObjectURL(b));
    p.catch(() => blobUrls.delete(m.url!));
    blobUrls.set(m.url, p);
  }
  return p;
}

export function useMediaSrc(m: GeneratedMedia): { src: string; failed: boolean; retry(): void } {
  const first = srcOf(m);
  const [state, setState] = useState<{ src: string; failed: boolean }>(() => ({ src: typeof first === 'string' ? first : '', failed: false }));
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const s = srcOf(m);
    if (typeof s === 'string') {
      setState({ src: s, failed: false });
      return;
    }
    let live = true;
    s.then(
      (src) => live && setState({ src, failed: false }),
      () => live && setState({ src: '', failed: true }),
    );
    return () => {
      live = false;
    };
  }, [m.url, m.dataUrl, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, retry: () => setAttempt((n) => n + 1) };
}

async function blobOf(m: GeneratedMedia): Promise<Blob> {
  if (m.url?.startsWith('/api/media/')) return fetchStoredMedia(m.url);
  const src = m.dataUrl ?? m.url;
  if (!src) throw new Error('No file');
  return (await fetch(src)).blob();
}

function fileName(m: GeneratedMedia) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
  return `catgpt-${m.kind}-${stamp}.${extOf(m.mime)}`;
}

async function download(m: GeneratedMedia) {
  try {
    const blob = await blobOf(m);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName(m);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  } catch {
    // Provider links that block cross-origin reads: open them instead.
    if (m.url) window.open(m.url, '_blank', 'noopener');
  }
}

async function addAsReference(m: GeneratedMedia, done: string) {
  try {
    const blob = await blobOf(m);
    await addFiles([new File([blob], fileName(m), { type: blob.type || m.mime })]);
    toast(done, 'success');
    window.dispatchEvent(new Event('omnichat:focus-composer'));
  } catch (err) {
    toast((err as Error).message, 'error');
  }
}

function Tool({ title, onClick, children }: { title: string; onClick(): void; children: React.ReactNode }) {
  return (
    <IconButton
      size="sm"
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="bg-black/55 text-white backdrop-blur hover:bg-black/75 hover:text-white"
    >
      {children}
    </IconButton>
  );
}

function ImageItem({ m, single, onOpen }: { m: GeneratedMedia; single: boolean; onOpen(m: GeneratedMedia): void }) {
  const t = useT();
  const { src, failed, retry } = useMediaSrc(m);
  const [broken, setBroken] = useState(false);
  return (
    <div className={cn('group relative overflow-hidden rounded-xl border border-line bg-muted', single ? 'max-w-md' : '')} data-generated-image="">
      {failed || broken ? (
        <button
          type="button"
          onClick={() => {
            setBroken(false);
            retry();
          }}
          className="flex aspect-square w-full items-center justify-center gap-1.5 p-4 text-xs text-fg-subtle hover:text-fg"
        >
          <AlertTriangle className="size-4" />
          {t('media.loadFailed')}
        </button>
      ) : src ? (
        <button type="button" className="block w-full" onClick={() => onOpen(m)} title={m.revisedPrompt}>
          <img src={src} alt={m.revisedPrompt ?? ''} className="block h-auto w-full" loading="lazy" onError={() => setBroken(true)} />
        </button>
      ) : (
        <div className="flex aspect-square items-center justify-center">
          <Loader2 className="size-5 animate-spin text-fg-subtle" />
        </div>
      )}
      <div className="absolute top-2 right-2 flex gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
        <Tool title={t('media.open')} onClick={() => onOpen(m)}>
          <Maximize2 />
        </Tool>
        <Tool title={t('media.reference')} onClick={() => void addAsReference(m, t('media.referenceAdded'))}>
          <ImagePlus />
        </Tool>
        <Tool title={t('media.download')} onClick={() => void download(m)}>
          <Download />
        </Tool>
      </div>
      {m.url && !m.url.startsWith('/api/media/') && (
        <span title={t('media.external')} className="absolute bottom-2 left-2 rounded-md bg-black/55 p-1 text-white">
          <Link2 className="size-3" />
        </span>
      )}
    </div>
  );
}

function VideoItem({ m }: { m: GeneratedMedia }) {
  const t = useT();
  const { src, failed, retry } = useMediaSrc(m);
  return (
    <div className="group relative max-w-xl overflow-hidden rounded-xl border border-line bg-black" data-generated-video="">
      {failed ? (
        <button type="button" onClick={retry} className="flex aspect-video w-full items-center justify-center gap-1.5 text-xs text-white/70 hover:text-white">
          <AlertTriangle className="size-4" />
          {t('media.loadFailed')}
        </button>
      ) : src ? (
        <video src={src} controls playsInline preload="metadata" className="block max-h-[70vh] w-full" />
      ) : (
        <div className="flex aspect-video items-center justify-center">
          <Loader2 className="size-5 animate-spin text-white/60" />
        </div>
      )}
      <div className="absolute top-2 right-2 flex gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
        <Tool title={t('media.download')} onClick={() => void download(m)}>
          <Download />
        </Tool>
      </div>
    </div>
  );
}

function Viewer({ m, onClose }: { m: GeneratedMedia | null; onClose(): void }) {
  const t = useT();
  const { src } = useMediaSrc(m ?? { id: '', kind: 'image', mime: 'image/png' });
  return (
    <Modal open={!!m} onClose={onClose} title={t('model.outputImage')} size="xl" mobileFull bodyClassName="p-0">
      {m && (
        <div className="flex flex-col items-center gap-3 p-3">
          {src && <img src={src} alt={m.revisedPrompt ?? ''} className="max-h-[75dvh] max-w-full rounded-lg object-contain" />}
          {m.revisedPrompt && (
            <p className="max-w-3xl text-xs leading-relaxed text-fg-muted">
              <span className="font-medium text-fg">{t('media.revised')}：</span>
              {m.revisedPrompt}
            </p>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={() => void download(m)} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-muted">
              <Download className="size-4" />
              {t('media.download')}
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                void addAsReference(m, t('media.referenceAdded'));
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-muted"
            >
              <ImagePlus className="size-4" />
              {t('media.reference')}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function MediaGallery({ media }: { media: GeneratedMedia[] }) {
  const [open, setOpen] = useState<GeneratedMedia | null>(null);
  const images = media.filter((m) => m.kind === 'image');
  const videos = media.filter((m) => m.kind === 'video');
  return (
    <div className="mt-1 space-y-2">
      {images.length > 0 && (
        <div className={cn('grid gap-2', images.length === 1 ? 'grid-cols-1' : 'max-w-2xl grid-cols-2')}>
          {images.map((m) => (
            <ImageItem key={m.id} m={m} single={images.length === 1} onOpen={setOpen} />
          ))}
        </div>
      )}
      {videos.map((m) => (
        <VideoItem key={m.id} m={m} />
      ))}
      <Viewer m={open} onClose={() => setOpen(null)} />
    </div>
  );
}

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function useElapsed(since: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, now - since);
}

/** Shown while an image or video is being generated. */
export function MediaProgress({ kind, progress, since, aspect, background }: { kind: 'image' | 'video'; progress?: GenProgress; since: number; aspect?: string; background: boolean }) {
  const t = useT();
  const elapsed = useElapsed(since);
  const label =
    progress?.stage === 'queued' ? t('media.queued') : progress?.stage === 'saving' ? t('media.saving') : kind === 'video' ? t('media.generatingVideo') : t('media.generatingImage');
  const ratio = aspectValue(aspect ?? (kind === 'video' ? '16:9' : '1:1'));
  const Icon = kind === 'video' ? Clapperboard : ImageIcon;
  return (
    <div className="max-w-sm" data-media-progress="">
      <div
        className="media-shimmer relative flex w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border border-line bg-muted text-fg-muted"
        style={{ aspectRatio: String(Math.max(0.5, Math.min(2, ratio))) }}
      >
        <Icon className="size-7 animate-pulse text-accent" />
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-fg-subtle tabular-nums">
          {progress?.percent !== undefined ? `${progress.percent}% · ` : ''}
          {clock(elapsed)}
        </div>
        {progress?.percent !== undefined && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-line">
            <div className="h-full bg-accent transition-[width] duration-700" style={{ width: `${progress.percent}%` }} />
          </div>
        )}
      </div>
      {kind === 'video' && (
        <p className="mt-1.5 text-xs text-fg-subtle">
          {t('media.videoWait')}
          {background ? ` ${t('media.canLeave')}` : ''}
        </p>
      )}
    </div>
  );
}
