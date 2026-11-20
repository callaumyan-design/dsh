import { getPreset } from '@/lib/ai/presets';
import { cn } from '@/lib/utils';
import type { Provider } from '@/lib/types';

function hashColor(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 55% 48%)`;
}

export function initials(name: string) {
  const clean = name.replace(/[（(].*$/, '').trim();
  if (/^[\u4e00-\u9fff]/.test(clean)) return clean.slice(0, 1);
  const words = clean.split(/[\s·\-_/]+/).filter((w) => /^[A-Za-z0-9]/.test(w));
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  const w = words[0] ?? clean;
  return w.slice(0, 2).replace(/^./, (c) => c.toUpperCase());
}

export function ProviderAvatar({
  provider,
  presetId,
  name,
  size = 'md',
  className,
}: {
  provider?: Pick<Provider, 'name' | 'presetId'>;
  presetId?: string;
  name?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const pid = provider?.presetId ?? presetId;
  const label = provider?.name ?? name ?? '?';
  const preset = getPreset(pid);
  const color = preset && !pid?.startsWith('custom') ? preset.color : hashColor(label);
  const dims = { xs: 'size-4 text-[8px] rounded', sm: 'size-5 text-[9px] rounded-md', md: 'size-7 text-[11px] rounded-lg', lg: 'size-9 text-xs rounded-xl' }[size];
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center font-semibold tracking-tight text-white select-none', dims, className)}
      style={{ background: color }}
      aria-hidden
    >
      {initials(label)}
    </span>
  );
}
