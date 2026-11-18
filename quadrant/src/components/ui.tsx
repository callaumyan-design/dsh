import { Check, X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { QMAP, QUADRANTS } from '../lib/quadrants';
import type { QuadrantId } from '../lib/types';

export function Checkbox({
  checked,
  onChange,
  quadrant,
  label,
  size = 'md',
  pop,
}: {
  checked: boolean;
  onChange: () => void;
  quadrant?: QuadrantId;
  label: string;
  size?: 'sm' | 'md';
  pop?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      className={`check check-${size}${checked ? ' is-checked' : ''}${pop ? ' is-pop' : ''}${quadrant ? ` q-${quadrant}` : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') e.stopPropagation();
      }}
    >
      <Check aria-hidden strokeWidth={3} />
    </button>
  );
}

/** 竖排文字：逐字堆叠，不依赖字体的竖排度量 */
export function VText({ text }: { text: string }) {
  return (
    <span className="vtext">
      {[...text].map((c, i) => (
        <span key={i}>{c}</span>
      ))}
    </span>
  );
}

/**
 * 十字坐标轴：画在四个象限中间。
 * 纵轴（上=重要，下=不重要）位于左右两列之间，横轴（左=紧急，右=不紧急）位于上下两行之间，
 * 每个标签正好落在它所描述的两个象限之间。容器需使用网格区域
 * 'q1 y1 q2' / 'x1 o x2' / 'q3 y2 q4'。
 */
export function CenterAxes() {
  return (
    <>
      <div className="cax cax-y cax-y1" aria-hidden>
        <i className="cax-arrow" />
        <span className="cax-label">
          <VText text="重要" />
        </span>
      </div>
      <div className="cax cax-y cax-y2" aria-hidden>
        <span className="cax-label">
          <VText text="不重要" />
        </span>
      </div>
      <div className="cax cax-x cax-x1" aria-hidden>
        <i className="cax-arrow" />
        <span className="cax-label">紧急</span>
      </div>
      <div className="cax cax-x cax-x2" aria-hidden>
        <span className="cax-label">不紧急</span>
      </div>
      <div className="cax-origin" aria-hidden />
    </>
  );
}

/** 2×2 的象限选择器：以矩阵本身作为控件 */
export function QuadrantPicker({
  value,
  onChange,
  compact,
}: {
  value: QuadrantId;
  onChange: (q: QuadrantId) => void;
  compact?: boolean;
}) {
  const name = useId();
  return (
    <div className={`qpicker axes-grid${compact ? ' is-compact' : ''}`} role="radiogroup" aria-label="选择象限">
      <CenterAxes />
      {QUADRANTS.map((q) => (
        <label key={q.id} className={`qpicker-cell q-${q.id}${value === q.id ? ' is-on' : ''}`}>
          <input
            type="radio"
            name={name}
            value={q.id}
            checked={value === q.id}
            onChange={() => onChange(q.id)}
          />
          <span className="qpicker-code">{q.code}</span>
          <span className="qpicker-verb">{q.verb}</span>
        </label>
      ))}
    </div>
  );
}

export function QBadge({ q, withVerb = true }: { q: QuadrantId; withVerb?: boolean }) {
  const m = QMAP[q];
  return (
    <span className={`qbadge q-${q}`}>
      <b>{m.code}</b>
      {withVerb && <span>{m.verb}</span>}
    </span>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  className = '',
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('[data-autofocus]') ?? el?.querySelector<HTMLElement>('input,textarea,button');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab' && el) {
        const items = [...el.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])')].filter(
          (x) => x.offsetParent !== null,
        );
        if (!items.length) return;
        const f = items[0];
        const l = items[items.length - 1];
        if (e.shiftKey && document.activeElement === f) {
          e.preventDefault();
          l.focus();
        } else if (!e.shiftKey && document.activeElement === l) {
          e.preventDefault();
          f.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-layer" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={`modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy ?? (title ? titleId : undefined)}
      >
        {title && (
          <header className="modal-head">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
              <X />
            </button>
          </header>
        )}
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'is-on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; id: string }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch${checked ? ' is-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

/** 浮层菜单：渲染到 body，按锚点定位，避免被滚动容器裁切 */
export function Popover({
  anchor,
  onClose,
  children,
  width = 224,
  className = '',
}: {
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const a = anchor.current?.getBoundingClientRect();
    if (!a) return;
    const h = ref.current?.offsetHeight ?? 240;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(8, Math.min(a.right - width, vw - width - 8));
    if (a.bottom + h + 8 > vh && a.top - h - 8 > 0) setPos({ bottom: vh - a.top + 4, left });
    else setPos({ top: Math.min(a.bottom + 4, vh - h - 8), left });
  }, [anchor, width]);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.current?.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        anchor.current?.focus();
      }
    };
    const onScroll = () => onClose();
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [onClose, anchor]);
  useEffect(() => {
    if (pos) ref.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus();
  }, [pos]);
  return createPortal(
    <div
      ref={ref}
      className={`menu ${className}`}
      role="menu"
      style={{ width, top: pos?.top, bottom: pos?.bottom, left: pos?.left ?? -9999, visibility: pos ? 'visible' : 'hidden' }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}
