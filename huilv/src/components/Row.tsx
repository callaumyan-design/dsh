import { useRef, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChartCandlestick, GripVertical, Minus, Replace } from 'lucide-react';
import { CURRENCY_MAP } from '../lib/currencies';
import { Flag } from './Flag';

const LONG_PRESS_MS = 450;

function sizeClass(text: string): string {
  const n = text.length;
  if (n > 20) return 'len-xl';
  if (n > 16) return 'len-l';
  if (n > 12) return 'len-m';
  return '';
}

export interface RowProps {
  code: string;
  active: boolean;
  /** 大号数字（已格式化） */
  value: string;
  /** 第二行左侧：汇率或算式结果 */
  sub: string;
  /** 涨跌幅文本与方向 */
  change?: { text: string; dir: 'up' | 'down' | 'flat' } | null;
  missing?: boolean;
  /** 第一次使用时轻轻滑动一下，提示可以左右滑 */
  peek?: boolean;
  onSelect: () => void;
  onCopy: () => void;
  /** 向左滑：更换这一行的货币 */
  onSwap: () => void;
  /** 向右滑：查看走势 */
  onTrend: () => void;
}

/** 滑过这个距离松手就触发 */
const SWIPE_TRIGGER = 76;
/** 超过这个距离后阻力变大 */
const SWIPE_MAX = 120;

type Gesture = {
  id: number;
  t: number;
  x: number;
  y: number;
  timer: number;
  long: boolean;
  /** undefined：还没判断方向 */
  axis?: 'x' | 'y';
  dx: number;
};

/** 普通模式下的一行：点按切换为输入货币，长按（或右键）复制，左滑更换货币，右滑看走势 */
export function Row({ code, active, value, sub, change, missing, peek, onSelect, onCopy, onSwap, onTrend }: RowProps) {
  const c = CURRENCY_MAP[code];
  const g = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const clearDir = useRef(0);

  const setOffset = (dx: number, animate: boolean) => {
    const el = btn.current;
    const w = wrap.current;
    if (!el || !w) return;
    el.style.transition = animate ? 'transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1), background-color 0.15s ease' : 'none';
    el.style.transform = dx ? `translate3d(${dx}px, 0, 0)` : '';
    window.clearTimeout(clearDir.current);
    if (dx) w.dataset.dir = dx > 0 ? 'right' : 'left';
    // 回弹动画结束后再藏起下面的操作
    else if (animate) clearDir.current = window.setTimeout(() => (w.dataset.dir = ''), 240);
    else w.dataset.dir = '';
    const armed = Math.abs(dx) >= SWIPE_TRIGGER;
    if (armed && w.dataset.armed !== '1') navigator.vibrate?.(6);
    w.dataset.armed = armed ? '1' : '';
  };

  const endPress = () => {
    if (g.current) window.clearTimeout(g.current.timer);
    btn.current?.classList.remove('is-pressing');
  };

  const copyNow = () => {
    endPress();
    g.current = null;
    suppressClick.current = true;
    onCopy();
  };

  const onPointerDown = (e: RPointerEvent<HTMLButtonElement>) => {
    suppressClick.current = false;
    if (e.button !== 0) return;
    // 另一根手指正在滑动时忽略（超过 3 秒的视为残留状态）
    if (g.current && Date.now() - g.current.t < 3000) return;
    const timer = window.setTimeout(() => {
      const cur = g.current;
      if (cur && !cur.axis) {
        cur.long = true;
        btn.current?.classList.add('is-pressing');
        navigator.vibrate?.(8);
      }
    }, LONG_PRESS_MS);
    g.current = { id: e.pointerId, t: Date.now(), x: e.clientX, y: e.clientY, timer, long: false, dx: 0 };
  };

  const onPointerMove = (e: RPointerEvent<HTMLButtonElement>) => {
    const cur = g.current;
    if (!cur || cur.id !== e.pointerId) return;
    const dx = e.clientX - cur.x;
    const dy = e.clientY - cur.y;
    if (!cur.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      endPress();
      cur.long = false;
      cur.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
      if (cur.axis === 'x') e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    if (cur.axis !== 'x') return;
    // 超过最大距离后阻力变大
    const abs = Math.abs(dx);
    const eased = abs <= SWIPE_MAX ? abs : SWIPE_MAX + (abs - SWIPE_MAX) * 0.25;
    cur.dx = Math.sign(dx) * eased;
    setOffset(cur.dx, false);
  };

  const finish = (e: RPointerEvent<HTMLButtonElement>, cancelled: boolean) => {
    const cur = g.current;
    if (!cur || cur.id !== e.pointerId) return;
    endPress();
    g.current = null;
    if (cur.axis === 'x') {
      suppressClick.current = true;
      setOffset(0, true);
      if (!cancelled && cur.dx <= -SWIPE_TRIGGER) onSwap();
      else if (!cancelled && cur.dx >= SWIPE_TRIGGER) onTrend();
      return;
    }
    // 在抬起手指时复制：Safari 只在这一刻允许写剪贴板
    if (!cancelled && !cur.axis && (cur.long || Date.now() - cur.t >= LONG_PRESS_MS)) {
      suppressClick.current = true;
      onCopy();
    }
  };

  return (
    <div ref={wrap} className={`row-wrap${peek ? ' is-peek' : ''}`} data-wrap={code}>
      <div className="row-actions" aria-hidden="true">
        <span className="act act-trend">
          <ChartCandlestick size={22} />
          走势
        </span>
        <span className="act act-swap">
          <Replace size={21} />
          更换
        </span>
      </div>
      <button
        ref={btn}
        type="button"
        className={`row${active ? ' is-active' : ''}${missing ? ' is-missing' : ''}`}
        data-code={code}
        aria-pressed={active}
        aria-label={`${c?.name ?? code} ${code}，${missing ? '暂无汇率' : value}`}
        aria-description="左滑更换货币，右滑查看走势，长按复制"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => finish(e, false)}
        onPointerCancel={(e) => {
          // 浏览器接管了竖向滚动
          const cur = g.current;
          finish(e, true);
          if (cur?.axis === 'x') setOffset(0, true);
        }}
        onContextMenu={(e) => {
          // 鼠标右键、安卓长按都会触发；阻止系统菜单，直接复制
          e.preventDefault();
          if (g.current?.axis === 'x') return;
          if (!suppressClick.current) copyNow();
        }}
        onClick={(e) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          // 点按后不保留焦点，这样电脑上接着按回车是“等于”，而不是再点一次这一行
          if (e.detail > 0) e.currentTarget.blur();
          onSelect();
        }}
      >
        <Flag code={code} />
        <span className="meta">
          <span className="code">{code}</span>
          <span className="name">{c?.name}</span>
        </span>
        <span className="value">
          <span className={`amount ${sizeClass(value)}`}>
            {value}
            {active && <span className="caret" aria-hidden="true" />}
          </span>
          <span className="sub">
            <span className="sub-text">{sub}</span>
            {change && <span className={`chg chg-${change.dir}`}>{change.text}</span>}
          </span>
        </span>
      </button>
    </div>
  );
}

/** 编辑模式下的一行：拖动排序、删除 */
export function EditRow({ code, canRemove, onRemove }: { code: string; canRemove: boolean; onRemove: () => void }) {
  const c = CURRENCY_MAP[code];
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: code });
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} className={`row is-edit${isDragging ? ' is-dragging' : ''}`} data-code={code}>
      <button
        type="button"
        className="remove"
        onClick={onRemove}
        disabled={!canRemove}
        aria-label={`移除 ${c?.name ?? code}`}
        title={canRemove ? '移除' : '至少保留一种货币'}
      >
        <Minus size={14} strokeWidth={3} />
      </button>
      <Flag code={code} />
      <span className="meta">
        <span className="code">{code}</span>
        <span className="name">{c?.name}</span>
      </span>
      <button type="button" className="handle" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`拖动排序 ${c?.name ?? code}`}>
        <GripVertical size={20} />
      </button>
    </div>
  );
}
