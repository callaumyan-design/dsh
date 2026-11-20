import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { X } from 'lucide-react';

/** 往下拖过面板高度的这个比例，或者快速往下一甩，就关闭 */
const DISMISS_RATIO = 0.25;
const DISMISS_MAX = 160;
const FLICK_V = 0.55;
const FLICK_MIN = 32;
/** 关闭动画的时长，和 CSS 里的 sheet-sink 一致 */
const LEAVE_MS = 220;

type Drag = {
  x0: number;
  y0: number;
  /** 判定为下拉后，从这里开始跟手，不会突然跳一下 */
  yLock: number;
  dragging: boolean;
  dy: number;
  lastY: number;
  lastT: number;
  v: number;
};

/**
 * 手机上从底部弹出、电脑上居中显示的面板。
 * 手机上可以按住顶部往下拖动关闭；内容已经滚到顶部时，从内容区往下拖也可以。
 */
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
  const layer = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<Element | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // 关闭时先播放滑出动画再卸载；期间显示关闭前的内容
  const [mounted, setMounted] = useState(open);
  const [leaving, setLeaving] = useState(false);
  const shown = useRef({ title, children, footer, head });
  if (open) shown.current = { title, children, footer, head };

  useEffect(() => {
    if (open) {
      setMounted(true);
      setLeaving(false);
      return;
    }
    if (!mounted) return;
    setLeaving(true);
    const t = window.setTimeout(() => {
      setMounted(false);
      setLeaving(false);
    }, LEAVE_MS);
    return () => window.clearTimeout(t);
  }, [open, mounted]);

  // 打开时把焦点移进面板，Esc 关闭，关闭后焦点回到原来的位置
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
        closeRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey, true);
      (lastFocus.current as HTMLElement | null)?.focus?.();
    };
  }, [open]);

  // 下拉关闭（只处理触摸；电脑上是居中的弹窗，用关闭按钮或 Esc）
  useEffect(() => {
    const el = panel.current;
    const lay = layer.current;
    if (!open || !el || !lay) return;
    let d: Drag | null = null;
    let raf = 0;

    const paint = () => {
      raf = 0;
      if (!d) return;
      el.style.transform = d.dy ? `translate3d(0,${d.dy.toFixed(1)}px,0)` : '';
      lay.style.setProperty('--scrim-k', String(Math.max(0, 1 - d.dy / Math.max(1, el.offsetHeight))));
    };

    const onStart = (e: TouchEvent) => {
      d = null;
      if (e.touches.length !== 1) return;
      const target = e.target as Element;
      // 图表上的拖动是用来查看每一天的价格；输入框里的拖动是选文字
      if (target.closest('.chart, input, textarea')) return;
      const body = el.querySelector('.sheet-body');
      if (target.closest('.sheet-body') && body && body.scrollTop > 0) return;
      const t = e.touches[0];
      d = { x0: t.clientX, y0: t.clientY, yLock: t.clientY, dragging: false, dy: 0, lastY: t.clientY, lastT: e.timeStamp, v: 0 };
    };

    const onMove = (e: TouchEvent) => {
      if (!d) return;
      const t = e.touches[0];
      if (!d.dragging) {
        const dx = t.clientX - d.x0;
        const dy = t.clientY - d.y0;
        // 一开始就往下：马上阻止浏览器开始回弹滚动，否则之后就拦不住了
        if (dy > 0 && dy >= Math.abs(dx) && e.cancelable) e.preventDefault();
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        // 往上或横向：交给页面正常滚动
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) {
          d = null;
          return;
        }
        d.dragging = true;
        d.yLock = t.clientY;
        el.style.transition = 'none';
        el.style.willChange = 'transform';
      }
      // 阻止内容区的回弹滚动，面板跟着手指走
      if (e.cancelable) e.preventDefault();
      const dt = Math.max(1, e.timeStamp - d.lastT);
      d.v = 0.7 * ((t.clientY - d.lastY) / dt) + 0.3 * d.v;
      d.lastY = t.clientY;
      d.lastT = e.timeStamp;
      const raw = t.clientY - d.yLock;
      // 往上拖有阻力
      d.dy = raw >= 0 ? raw : raw * 0.2;
      if (!raf) raf = requestAnimationFrame(paint);
    };

    const onEnd = () => {
      const cur = d;
      d = null;
      if (!cur?.dragging) return;
      cancelAnimationFrame(raf);
      raf = 0;
      const h = el.offsetHeight;
      const far = cur.dy > Math.min(DISMISS_MAX, h * DISMISS_RATIO);
      const flick = cur.v > FLICK_V && cur.dy > FLICK_MIN;
      if (far || flick) {
        // 顺着手势滑出去，然后关闭
        el.style.transition = `transform ${LEAVE_MS}ms cubic-bezier(0.3, 0.7, 0.4, 1)`;
        el.style.transform = `translate3d(0,${h + 24}px,0)`;
        lay.style.setProperty('--scrim-k', '0');
        lay.classList.add('is-dismissing');
        window.setTimeout(() => closeRef.current(), LEAVE_MS - 40);
      } else {
        el.style.transition = 'transform 280ms cubic-bezier(0.22, 1, 0.36, 1)';
        el.style.transform = '';
        lay.style.setProperty('--scrim-k', '1');
        window.setTimeout(() => {
          el.style.transition = '';
          el.style.willChange = '';
        }, 300);
      }
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [open, mounted]);

  if (!mounted) return null;
  const s = shown.current;
  return (
    <div
      ref={layer}
      className={`sheet-layer${leaving ? ' is-leaving' : ''}`}
      style={{ '--scrim-k': 1 } as CSSProperties}
      onPointerDown={(e) => e.target === e.currentTarget && !leaving && onClose()}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-label={s.title} ref={panel} tabIndex={-1}>
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          {s.head ?? <h2>{s.title}</h2>}
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            <X size={20} />
          </button>
        </div>
        <div className="sheet-body">{s.children}</div>
        {s.footer}
      </div>
    </div>
  );
}
