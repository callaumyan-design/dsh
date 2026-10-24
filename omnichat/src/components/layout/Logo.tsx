import { cn } from '@/lib/utils';

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('size-8', className)} aria-hidden>
      <defs>
        <linearGradient id="omni-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor="color-mix(in oklab, var(--accent) 55%, #22d3ee)" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#omni-g)" />
      <circle cx="32" cy="32" r="13" fill="none" stroke="#fff" strokeWidth="5" />
      <circle cx="32" cy="32" r="4.5" fill="#fff" />
      <circle cx="46.5" cy="17.5" r="4" fill="#fff" opacity=".9" />
    </svg>
  );
}
