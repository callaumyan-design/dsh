import clsx, { type ClassValue } from 'clsx';

export const cn = (...v: ClassValue[]) => clsx(v);

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function throttle<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;
  const run = () => {
    last = Date.now();
    timer = null;
    if (pending) {
      const a = pending;
      pending = null;
      fn(...a);
    }
  };
  const t = (...a: A) => {
    pending = a;
    const wait = ms - (Date.now() - last);
    if (wait <= 0) run();
    else if (!timer) timer = setTimeout(run, wait);
  };
  t.flush = () => {
    if (timer) clearTimeout(timer);
    run();
  };
  t.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  };
  return t;
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...a: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...a), ms);
  };
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function downloadFile(name: string, content: string | Blob, mime = 'application/json') {
  const blob = typeof content === 'string' ? new Blob([content], { type: mime }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFileAsDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function readFileAsText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

/** Downscales large images so they sync quickly and fit provider limits. */
export async function compressImage(file: File, maxSide = 2048, quality = 0.88): Promise<{ dataUrl: string; mime: string; size: number }> {
  const original = await readFileAsDataURL(file);
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return { dataUrl: original, mime: file.type, size: file.size };
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = original;
    });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) return { dataUrl: original, mime: file.type, size: file.size };
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d')!;
    const mime = file.type === 'image/png' && file.size < 4 * 1024 * 1024 ? 'image/png' : 'image/jpeg';
    if (mime === 'image/jpeg') {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL(mime, quality);
    return { dataUrl, mime, size: Math.round((dataUrl.length * 3) / 4) };
  } catch {
    return { dataUrl: original, mime: file.type, size: file.size };
  }
}

export function splitDataUrl(dataUrl: string): { mime: string; data: string } {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) return { mime: 'application/octet-stream', data: '' };
  return { mime: m[1] || 'application/octet-stream', data: m[3] };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDuration(ms?: number): string {
  if (!ms && ms !== 0) return '';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
}

export function formatNumber(n?: number): string {
  if (n === undefined || n === null) return '';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

const TEXT_EXT =
  /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|yaml|yml|toml|ini|cfg|conf|log|html?|css|scss|less|js|jsx|ts|tsx|mjs|cjs|vue|svelte|py|rb|go|rs|java|kt|kts|swift|c|h|cc|cpp|hpp|cs|php|sh|bash|zsh|ps1|bat|sql|r|m|scala|lua|pl|dart|ex|exs|erl|hs|clj|tex|srt|vtt|env|gitignore|dockerfile|makefile|gradle|properties)$/i;

export function isTextFile(file: File): boolean {
  if (file.type.startsWith('text/')) return true;
  if (/json|xml|yaml|javascript|typescript|x-sh|x-python|sql|csv/.test(file.type)) return true;
  return TEXT_EXT.test(file.name) || /^(dockerfile|makefile|readme|license)$/i.test(file.name);
}

export function startOfDay(t: number) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function isMac() {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

export function truncate(s: string, n: number) {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}
