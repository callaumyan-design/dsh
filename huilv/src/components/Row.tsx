import { useRef, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Minus } from 'lucide-react';
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
  onSelect: () => void;
  onCopy: () => void;
}

/** 普通模式下的一行：点按切换为基准货币，长按（或右键）复制金额 */
export function Row({ code, active, value, sub, change, missing, onSelect, onCopy }: RowProps) {
  const c = CURRENCY_MAP[code];
  const press = useRef<{ t: number; x: number; y: number; timer: number; long: boolean } | null>(null);
  const suppressClick = useRef(false);

  const clear = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };

  const copyNow = (el: HTMLElement) => {
    el.classList.remove('is-pressing');
    clear();
    suppressClick.current = true;
    onCopy();
  };

  const onPointerDown = (e: RPointerEvent<HTMLButtonElement>) => {
    suppressClick.current = false;
    if (e.button !== 0) return;
    const el = e.currentTarget;
    const timer = window.setTimeout(() => {
      if (press.current) {
        press.current.long = true;
        el.classList.add('is-pressing');
        navigator.vibrate?.(8);
      }
    }, LONG_PRESS_MS);
    press.current = { t: Date.now(), x: e.clientX, y: e.clientY, timer, long: false };
  };

  const onPointerMove = (e: RPointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) {
      e.currentTarget.classList.remove('is-pressing');
      clear();
    }
  };

  // 在抬起手指时复制：Safari 只在这一刻允许写剪贴板
  const onPointerUp = (e: RPointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (p && (p.long || Date.now() - p.t >= LONG_PRESS_MS)) copyNow(e.currentTarget);
    else {
      e.currentTarget.classList.remove('is-pressing');
      clear();
    }
  };

  return (
    <button
      type="button"
      className={`row${active ? ' is-active' : ''}${missing ? ' is-missing' : ''}`}
      data-code={code}
      aria-pressed={active}
      aria-label={`${c?.name ?? code} ${code}，${missing ? '暂无汇率' : value}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(e) => {
        e.currentTarget.classList.remove('is-pressing');
        clear();
      }}
      onContextMenu={(e) => {
        // 鼠标右键、安卓长按都会触发；阻止系统菜单，直接复制
        e.preventDefault();
        if (!suppressClick.current) copyNow(e.currentTarget);
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
