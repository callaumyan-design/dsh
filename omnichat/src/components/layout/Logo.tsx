import { cn } from '@/lib/utils';

// CatGPT glitch cat: the cat takes the tile's color (white in light mode, black in dark mode)
// and only the RGB-split edges, eyes and nose stand out.
const HEAD = 'M26 102 Q18 80 26 60 L22 20 L50 40 Q64 36 78 40 L106 20 L102 60 Q110 80 102 102 Q64 120 26 102 Z';

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 128 128" className={cn('size-8', className)} aria-hidden>
      <rect x="1" y="1" width="126" height="126" rx="27" strokeWidth="2" className="fill-white stroke-black/10 dark:fill-[#0b0b14] dark:stroke-white/10" />
      <path d={HEAD} fill="#22e6ff" transform="translate(-4 0)" opacity=".9" />
      <path d={HEAD} fill="#ff2bd6" transform="translate(4 1)" opacity=".9" />
      <path d={HEAD} className="fill-white dark:fill-[#0b0b14]" />
      <rect x="18" y="44" width="40" height="5" fill="#22e6ff" opacity=".8" />
      <rect x="70" y="96" width="34" height="4" fill="#ff2bd6" opacity=".8" />
      <path d="M42 66 L56 62 L56 72 Z M86 66 L72 62 L72 72 Z M60 86 h8 l-4 4z" className="fill-[#14141f] dark:fill-[#f4f4ff]" />
      <rect x="40" y="76" width="22" height="3" fill="#ff2bd6" />
    </svg>
  );
}
