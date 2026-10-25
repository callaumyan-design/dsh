import { cn } from '@/lib/utils';

// CatGPT glitch cat: RGB-split head on a white tile in light mode, a dark tile in dark mode.
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 128 128" className={cn('size-8', className)} aria-hidden>
      <defs>
        <linearGradient id="catgpt-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#07070d" />
          <stop offset="1" stopColor="#14081c" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="126" height="126" rx="27" strokeWidth="2" className="fill-white stroke-black/10 dark:fill-[url(#catgpt-g)] dark:stroke-white/10" />
      <path d="M26 102 Q18 80 26 60 L22 20 L50 40 Q64 36 78 40 L106 20 L102 60 Q110 80 102 102 Q64 120 26 102 Z" fill="#22e6ff" transform="translate(-4 0)" opacity=".9" />
      <path d="M26 102 Q18 80 26 60 L22 20 L50 40 Q64 36 78 40 L106 20 L102 60 Q110 80 102 102 Q64 120 26 102 Z" fill="#ff2bd6" transform="translate(4 1)" opacity=".9" />
      <path d="M26 102 Q18 80 26 60 L22 20 L50 40 Q64 36 78 40 L106 20 L102 60 Q110 80 102 102 Q64 120 26 102 Z" fill="#0b0b14" />
      <rect x="18" y="44" width="40" height="5" fill="#22e6ff" opacity=".8" />
      <rect x="70" y="96" width="34" height="4" fill="#ff2bd6" opacity=".8" />
      <path d="M42 66 L56 62 L56 72 Z M86 66 L72 62 L72 72 Z" fill="#f4f4ff" />
      <rect x="40" y="76" width="22" height="3" fill="#ff2bd6" />
      <path d="M60 86 h8 l-4 4z" fill="#f4f4ff" />
    </svg>
  );
}
