import { forwardRef, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------- Button ----------

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type Size = 'xs' | 'sm' | 'md';

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover shadow-sm',
  secondary: 'bg-muted text-fg hover:bg-hover',
  ghost: 'text-fg-muted hover:bg-muted hover:text-fg',
  danger: 'bg-danger text-white hover:opacity-90 shadow-sm',
  outline: 'border border-line-strong text-fg hover:bg-muted',
};
const sizes: Record<Size, string> = {
  xs: 'h-7 px-2 text-xs gap-1 rounded-md',
  sm: 'h-8 px-3 text-sm gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      className={cn(
        'focus-ring inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-colors disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: 'sm' | 'md'; active?: boolean }>(
  function IconButton({ className, size = 'md', active, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        className={cn(
          'focus-ring inline-flex shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-muted hover:text-fg disabled:opacity-40',
          size === 'sm' ? 'size-7 [&_svg]:size-4' : 'size-9 [&_svg]:size-[18px]',
          active && 'bg-muted text-fg',
          className,
        )}
        {...rest}
      />
    );
  },
);

// ---------- Form controls ----------

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        'h-10 w-full rounded-xl border border-line bg-bg px-3 text-sm text-fg placeholder:text-fg-subtle transition-colors outline-none focus:border-accent focus:ring-3 focus:ring-accent-soft disabled:opacity-60',
        className,
      )}
      {...rest}
    />
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn(
        'w-full rounded-xl border border-line bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-subtle transition-colors outline-none focus:border-accent focus:ring-3 focus:ring-accent-soft',
        className,
      )}
      {...rest}
    />
  );
});

export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-10 w-full appearance-none rounded-xl border border-line bg-bg bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-9 pl-3 text-sm text-fg outline-none focus:border-accent focus:ring-3 focus:ring-accent-soft',
        "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]",
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange(v: boolean): void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'focus-ring relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
        checked ? 'bg-accent' : 'bg-line-strong',
      )}
    >
      <span className={cn('inline-block size-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
    </button>
  );
}

export function Field({ label, hint, children, className, action }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-fg">{label}</div>
        {action}
      </div>
      {children}
      {hint && <p className="text-xs leading-relaxed text-fg-subtle">{hint}</p>}
    </div>
  );
}

export function Row({ title, desc, children }: { title: ReactNode; desc?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium text-fg">{title}</div>
        {desc && <div className="mt-0.5 text-xs text-fg-subtle">{desc}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange(v: T): void }) {
  return (
    <div className="inline-flex rounded-xl bg-muted p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'focus-ring inline-flex h-7 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors',
            value === o.value ? 'bg-bg text-fg shadow-sm' : 'text-fg-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin', className)} />;
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-fg-muted', className)}>{children}</span>;
}

// ---------- Overlays ----------

// Escape closes only the top-most overlay.
const escapeStack: (() => void)[] = [];
let escapeInstalled = false;

/** Whether a modal, popover or dialog is open (Escape belongs to it). */
export function hasOpenOverlay() {
  return escapeStack.length > 0;
}

export function useEscape(active: boolean, onEscape: () => void) {
  const cb = useRef(onEscape);
  cb.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const fn = () => cb.current();
    escapeStack.push(fn);
    if (!escapeInstalled) {
      escapeInstalled = true;
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && escapeStack.length) {
          e.preventDefault();
          escapeStack[escapeStack.length - 1]();
        }
      });
    }
    return () => {
      const i = escapeStack.lastIndexOf(fn);
      if (i >= 0) escapeStack.splice(i, 1);
    };
  }, [active]);
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  mobileFull,
  className,
  bodyClassName,
}: {
  open: boolean;
  onClose(): void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  mobileFull?: boolean;
  className?: string;
  bodyClassName?: string;
}) {
  useEscape(open, onClose);
  if (!open) return null;
  const width = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-3xl', xl: 'sm:max-w-5xl' }[size];
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="anim-fade absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'anim-up relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-elevated shadow-pop sm:rounded-2xl',
          width,
          mobileFull && 'h-[100dvh] max-h-none rounded-none sm:h-auto sm:max-h-[88dvh] sm:rounded-2xl',
          className,
        )}
      >
        {title !== undefined && (
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
            <h2 className="text-base font-semibold text-fg">{title}</h2>
            <IconButton size="sm" onClick={onClose} aria-label="Close">
              <X />
            </IconButton>
          </div>
        )}
        <div className={cn('min-h-0 flex-1 overflow-y-auto', bodyClassName ?? 'px-5 py-4')}>{children}</div>
        {footer && <div className="safe-bottom flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Popover({
  open,
  onClose,
  anchor,
  children,
  align = 'start',
  className,
  width,
  matchWidth,
}: {
  open: boolean;
  onClose(): void;
  anchor: React.RefObject<HTMLElement | null>;
  children: ReactNode;
  align?: 'start' | 'end' | 'center';
  className?: string;
  width?: number;
  matchWidth?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number; width?: number } | null>(null);
  useEscape(open, onClose);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const el = ref.current;
      if (!a || !el) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = matchWidth ? a.width : Math.min(width ?? el.offsetWidth, vw - 16);
      const h = el.scrollHeight;
      const below = vh - a.bottom - 12;
      const above = a.top - 12;
      const placeBelow = below >= Math.min(h, 320) || below >= above;
      const maxHeight = Math.max(160, placeBelow ? below : above);
      const shownH = Math.min(h, maxHeight);
      let left = align === 'end' ? a.right - w : align === 'center' ? a.left + a.width / 2 - w / 2 : a.left;
      left = Math.max(8, Math.min(left, vw - w - 8));
      const top = placeBelow ? a.bottom + 6 : a.top - 6 - shownH;
      setPos({ top, left, maxHeight, width: matchWidth || width ? w : undefined });
    };
    place();
    const ro = new ResizeObserver(place);
    if (ref.current) ro.observe(ref.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchor, align, width, matchWidth]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || anchor.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('mousedown', h);
    document.addEventListener('touchstart', h);
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('touchstart', h);
    };
  }, [open, onClose, anchor]);

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      data-popover=""
      style={{
        position: 'fixed',
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        maxHeight: pos?.maxHeight,
        width: pos?.width ?? width,
        visibility: pos ? 'visible' : 'hidden',
      }}
      className={cn('anim-pop z-[60] overflow-y-auto rounded-xl border border-line bg-elevated p-1 shadow-pop', className)}
    >
      {children}
    </div>,
    document.body,
  );
}

export function MenuItem({
  icon,
  children,
  onClick,
  danger,
  active,
  right,
  disabled,
}: {
  icon?: ReactNode;
  children: ReactNode;
  onClick?(): void;
  danger?: boolean;
  active?: boolean;
  right?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors disabled:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0',
        danger ? 'text-danger hover:bg-danger/10' : 'text-fg hover:bg-muted',
        active && 'bg-muted',
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {right}
    </button>
  );
}

export function MenuDivider() {
  return <div className="my-1 h-px bg-line" />;
}

/** Click-to-open dropdown menu. */
export function Dropdown({
  trigger,
  children,
  align = 'end',
  width = 200,
}: {
  trigger(props: { ref: React.RefObject<HTMLButtonElement | null>; onClick(): void; open: boolean }): ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'start' | 'end';
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(false);
  return (
    <>
      {trigger({ ref, onClick: () => setOpen((v) => !v), open })}
      <Popover open={open} onClose={close} anchor={ref} align={align} width={width}>
        {children(close)}
      </Popover>
    </>
  );
}
