import { useEffect, useRef, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChartCandlestick, Copy, GripVertical, Minus, Replace } from 'lucide-react';
import { CURRENCY_MAP } from '../lib/currencies';
import { gesture } from '../lib/gesture';
import { Flag } from './Flag';

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
  /** 不画底部分隔线（最后一行、当前输入行的上一行） */
  noSep?: boolean;
  /** 第一次使用时轻轻滑动一下，提示可以左右滑 */
  peek?: boolean;
  /** 电脑宽屏：鼠标悬停时显示“走势 / 更换 / 复制”按钮，并显示英文名 */
  wide?: boolean;
  /** 电脑宽屏：右侧走势栏正在显示这一行 */
  focus?: boolean;
  /** 行很矮（手动设了很多行）：缩小国旗、隐藏中文名 */
  compact?: boolean;
  onSelect: () => void;
  /** 右键复制（长按由排序逻辑处理：长按后不移动直接松手 = 复制） */
  onCopy: () => void;
  /** 向右滑：更换这一行的货币 */
  onSwap: () => void;
  /** 向左滑：查看走势 */
  onTrend: () => void;
}

/** 方向判定前允许的移动距离 */
const LOCK = 6;
/** 滑过这个距离松手就触发 */
const TRIGGER = 72;
/** 快速甩动：速度超过这个值（像素/毫秒）且滑过 FLICK_MIN 也触发 */
const FLICK_V = 0.45;
const FLICK_MIN = 28;
/** 超过这个距离后阻力变大 */
const MAX = 132;
const SNAP = 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1)';

type Track = {
  id: number;
  x0: number;
  y0: number;
  /** 方向锁定时手指的位置，之后从这里开始 1:1 跟手，不会突然跳一下 */
  lockX: number;
  axis?: 'x' | 'y';
  dx: number;
  lastX: number;
  lastT: number;
  v: number;
};

/** 普通模式下的一行：点按切换输入货币；左滑看走势，右滑更换货币；长按后上下拖动排序 */
export function Row({ code, active, value, sub, change, missing, noSep, peek, wide, focus, compact, onSelect, onCopy, onSwap, onTrend }: RowProps) {
  const c = CURRENCY_MAP[code];
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: code });
  const track = useRef<Track | null>(null);
  const suppressClick = useRef(false);
  const lastPointer = useRef('mouse');
  const wrap = useRef<HTMLDivElement | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const actSwap = useRef<HTMLSpanElement>(null);
  const actTrend = useRef<HTMLSpanElement>(null);
  const raf = useRef(0);
  const settle = useRef(0);
  const state = useRef<{ dir: '' | 'left' | 'right'; armed: boolean }>({ dir: '', armed: false });

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      window.clearTimeout(settle.current);
    },
    [],
  );

  /** 只在方向、是否到达触发点变化时才改 DOM 属性，其余每帧只改 transform 和 opacity */
  const paint = (dx: number) => {
    const el = btn.current;
    const w = wrap.current;
    if (!el || !w) return;
    el.style.transform = dx ? `translate3d(${dx.toFixed(1)}px,0,0)` : '';
    const dir = dx > 0 ? 'right' : dx < 0 ? 'left' : '';
    if (dir && dir !== state.current.dir) {
      state.current.dir = dir;
      w.dataset.dir = dir;
    }
    const armed = Math.abs(dx) >= TRIGGER;
    if (armed !== state.current.armed) {
      state.current.armed = armed;
      w.dataset.armed = armed ? '1' : '';
      if (armed) navigator.vibrate?.(6);
    }
    const act = dx > 0 ? actSwap.current : actTrend.current;
    if (act) {
      const p = Math.min(1, Math.abs(dx) / TRIGGER);
      act.style.opacity = String(0.35 + 0.65 * p);
      act.style.transform = `scale(${armed ? 1 : 0.86 + 0.1 * p})`;
    }
  };

  const snapBack = () => {
    const el = btn.current;
    const w = wrap.current;
    if (!el || !w) return;
    cancelAnimationFrame(raf.current);
    raf.current = 0;
    el.style.transition = SNAP;
    paint(0);
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      // 回弹结束后再藏起下面的操作，并撤销图层提升
      el.style.transition = '';
      el.style.willChange = '';
      state.current = { dir: '', armed: false };
      w.dataset.dir = '';
      w.dataset.armed = '';
    }, 340);
  };

  const onPointerDown = (e: RPointerEvent<HTMLButtonElement>) => {
    lastPointer.current = e.pointerType;
    suppressClick.current = false;
    if (e.button !== 0 || gesture.sorting) return;
    if (track.current && track.current.id !== e.pointerId) return;
    track.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, lockX: e.clientX, dx: 0, lastX: e.clientX, lastT: e.timeStamp, v: 0 };
  };

  const onPointerMove = (e: RPointerEvent<HTMLButtonElement>) => {
    const t = track.current;
    if (!t || t.id !== e.pointerId) return;
    if (gesture.sorting) {
      // 长按后进入了排序，不再当作横滑
      if (t.axis === 'x') snapBack();
      track.current = null;
      return;
    }
    if (!t.axis) {
      const ax = Math.abs(e.clientX - t.x0);
      const ay = Math.abs(e.clientY - t.y0);
      if (ax < LOCK && ay < LOCK) return;
      t.axis = ax > ay ? 'x' : 'y';
      if (t.axis === 'y') return;
      t.lockX = e.clientX;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      window.clearTimeout(settle.current);
      const el = btn.current!;
      el.style.transition = 'none';
      el.style.willChange = 'transform';
      gesture.swiping = true;
    }
    if (t.axis !== 'x') return;

    // 速度（指数平滑），用于判断快速甩动
    const dt = Math.max(1, e.timeStamp - t.lastT);
    t.v = 0.7 * ((e.clientX - t.lastX) / dt) + 0.3 * t.v;
    t.lastX = e.clientX;
    t.lastT = e.timeStamp;

    const raw = e.clientX - t.lockX;
    const abs = Math.abs(raw);
    t.dx = Math.sign(raw) * (abs <= MAX ? abs : MAX + (abs - MAX) * 0.3);
    if (!raf.current) {
      raf.current = requestAnimationFrame(() => {
        raf.current = 0;
        if (track.current?.axis === 'x') paint(track.current.dx);
      });
    }
  };

  const finish = (e: RPointerEvent<HTMLButtonElement>, cancelled: boolean) => {
    const t = track.current;
    if (!t || t.id !== e.pointerId) return;
    track.current = null;
    if (t.axis !== 'x') return;
    gesture.swiping = false;
    suppressClick.current = true;
    const flick = Math.abs(t.v) > FLICK_V && Math.abs(t.dx) > FLICK_MIN && Math.sign(t.v) === Math.sign(t.dx);
    const fire = !cancelled && (Math.abs(t.dx) >= TRIGGER || flick);
    snapBack();
    if (!fire) return;
    // 等回弹动画在合成层上开始后再打开面板，避免两者抢同一帧
    const action = t.dx > 0 ? onSwap : onTrend;
    requestAnimationFrame(() => window.setTimeout(action, 16));
  };

  const setRefs = (el: HTMLDivElement | null) => {
    wrap.current = el;
    setNodeRef(el);
  };

  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition };

  return (
    <div
      ref={setRefs}
      style={style}
      className={`row-wrap${peek ? ' is-peek' : ''}${isDragging ? ' is-lifted' : ''}${noSep ? ' no-sep' : ''}${focus ? ' is-focus' : ''}${compact ? ' is-compact' : ''}`}
      data-wrap={code}
    >
      <div className="row-actions" aria-hidden="true">
        <span className="act act-swap" ref={actSwap}>
          <Replace size={21} />
          更换
        </span>
        <span className="act act-trend" ref={actTrend}>
          走势
          <ChartCandlestick size={22} />
        </span>
      </div>
      <button
        ref={btn}
        type="button"
        className={`row${active ? ' is-active' : ''}${missing ? ' is-missing' : ''}`}
        data-code={code}
        aria-pressed={active}
        aria-label={`${c?.name ?? code} ${code}，${missing ? '暂无汇率' : value}`}
        aria-description="左滑查看走势，右滑更换货币，长按拖动排序"
        {...listeners}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => finish(e, false)}
        onPointerCancel={(e) => finish(e, true)}
        onContextMenu={(e) => {
          // 阻止系统菜单。鼠标右键直接复制；触摸长按由排序逻辑处理（不移动直接松手 = 复制）
          e.preventDefault();
          if (lastPointer.current === 'mouse' && !gesture.sorting) {
            suppressClick.current = true;
            onCopy();
          }
        }}
        onClick={(e) => {
          if (suppressClick.current || Date.now() - gesture.sortEndedAt < 400) {
            suppressClick.current = false;
            return;
          }
          // 点按后不保留焦点，这样电脑上接着按回车是“等于”，而不是再点一次这一行
          if (e.detail > 0) e.currentTarget.blur();
          onSelect();
        }}
      >
        <Flag code={code} size={compact ? 28 : 36} />
        <span className="meta">
          <span className="code">
            {code}
            {focus && <ChartCandlestick className="focus-mark" size={14} aria-label="走势栏正在显示" />}
          </span>
          <span className="name">
            {c?.name}
            {wide && <span className="name-en"> · {c?.en}</span>}
          </span>
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
      {wide && (
        <div className="row-tools">
          <button type="button" onClick={onTrend} title="查看走势（左滑）" aria-label={`查看 ${code} 走势`}>
            <ChartCandlestick size={17} />
          </button>
          <button type="button" onClick={onSwap} title="更换货币（右滑）" aria-label={`更换 ${code}`}>
            <Replace size={17} />
          </button>
          <button type="button" onClick={onCopy} title="复制金额（右键）" aria-label={`复制 ${code} 金额`}>
            <Copy size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

/** 编辑模式下的一行：拖动把手排序、删除 */
export function EditRow({ code, canRemove, hidden, onRemove }: { code: string; canRemove: boolean; hidden?: boolean; onRemove: () => void }) {
  const c = CURRENCY_MAP[code];
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: code });
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} className={`row is-edit${isDragging ? ' is-dragging' : ''}${hidden ? ' is-hidden-slot' : ''}`} data-code={code}>
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
        <span className="name">
          {c?.name}
          {hidden && <span className="tag">放不下</span>}
        </span>
      </span>
      <button type="button" className="handle" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`拖动排序 ${c?.name ?? code}`}>
        <GripVertical size={20} />
      </button>
    </div>
  );
}
