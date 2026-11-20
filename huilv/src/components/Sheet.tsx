import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

/** 手机上从底部弹出，电脑上居中显示的面板 */
export function Sheet({
  open,
  title,
  onClose,
  children,
  footer,
  head,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** 自定义标题栏内容（替换默认的标题文字） */
  head?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    lastFocus.current = document.activeElement;
    const t = window.setTimeout(() => {
      const auto = panel.current?.querySelector<HTMLElement>('[data-autofocus]');
      if (auto && window.matchMedia('(pointer: fine)').matches) auto.focus();
      else panel.current?.focus();
    }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey, true);
      (lastFocus.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="sheet-layer" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={panel} tabIndex={-1}>
        <div className="sheet-head">
          {head ?? <h2>{title}</h2>}
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            <X size={20} />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer}
      </div>
    </div>
  );
}
