import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { ArrowDownUp, Plus, RefreshCw, Settings2 } from 'lucide-react';
import { useStore } from './store';
import { hasOperator, type Key } from './lib/calc';
import { convert, perBase } from './lib/rates';
import { changePct, formatAgo, formatAmount, formatDateCN, formatExpr, formatPct, formatRate, unitFor } from './lib/format';
import { copyText } from './lib/clipboard';
import { gesture } from './lib/gesture';
import { Row, EditRow } from './components/Row';
import { Keypad } from './components/Keypad';
import { Picker } from './components/Picker';
import { Settings } from './components/Settings';
import { Trend, TrendPanel } from './components/Trend';

const HINT_KEY = 'huilv:hint-swipe';
/** 自动模式下每行至少这么高（像素），据此算出一屏放几行；电脑宽屏的行稍高一些 */
const MIN_ROW = 64;
const MIN_ROW_WIDE = 72;
const WIDE_QUERY = '(min-width: 960px) and (min-height: 560px)';

/** 电脑等宽屏：两栏布局 */
function useWide() {
  const [wide, setWide] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(WIDE_QUERY).matches);
  useEffect(() => {
    const mq = matchMedia(WIDE_QUERY);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

/** 测量列表区域的高度交给 store 算行数；手机上编辑模式会收起键盘，这时不重新计算 */
function useListHeight(editing: boolean, wide: boolean) {
  const ref = useRef<HTMLElement>(null);
  const setLayout = useStore((s) => s.setLayout);
  const editingRef = useRef(editing);
  editingRef.current = editing;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      if (editingRef.current && !wide) return;
      const cs = getComputedStyle(el);
      const h = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      if (h > 0) setLayout(h, wide ? MIN_ROW_WIDE : MIN_ROW);
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [setLayout, wide]);

  return ref;
}

const KEYMAP: Record<string, Key> = {
  '0': '0',
  '1': '1',
  '2': '2',
  '3': '3',
  '4': '4',
  '5': '5',
  '6': '6',
  '7': '7',
  '8': '8',
  '9': '9',
  '.': '.',
  ',': '.',
  '+': '+',
  '-': '-',
  '*': '*',
  x: '*',
  X: '*',
  '/': '/',
  '÷': '/',
  '×': '*',
  Enter: '=',
  '=': '=',
  Backspace: 'back',
  Escape: 'clear',
  Delete: 'clear',
  c: 'clear',
  C: 'clear',
};

function useTheme() {
  const theme = useStore((s) => s.theme);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-app-theme');
    else root.setAttribute('data-app-theme', theme);
    // 状态栏颜色跟着背景走
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', getComputedStyle(document.body).backgroundColor || '#f3f4f6');
  }, [theme]);
}

function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

export default function App() {
  const s = useStore();
  const { list, active, expr, rates, decimals, status, editing, toast, slots, listH } = s;
  const visible = useMemo(() => list.slice(0, slots), [list, slots]);
  const wide = useWide();
  const listRef = useListHeight(editing, wide);
  const rowH = listH > 0 ? Math.floor((listH / slots) * 10) / 10 : 72;
  const compact = rowH < 58;
  /** 电脑宽屏：右侧走势栏显示哪一行（null 表示第一个非输入货币） */
  const [focusCode, setFocusCode] = useState<string | null>(null);
  const [invertPair, setInvertPair] = useState(false);
  const [picker, setPicker] = useState(false);
  /** 正在更换的那一行（左滑） */
  const [swapFor, setSwapFor] = useState<string | null>(null);
  /** 正在查看走势的货币对（右滑） */
  const [trend, setTrend] = useState<{ from: string; to: string } | null>(null);
  const [settings, setSettings] = useState(false);
  const [peek, setPeek] = useState(false);
  const now = useNow(30_000);
  useTheme();

  // 打开时、切回前台时、恢复联网时更新汇率（一小时内更新过就跳过）
  useEffect(() => {
    const refresh = useStore.getState().refresh;
    refresh();
    const onVis = () => document.visibilityState === 'visible' && refresh();
    const onOnline = () => refresh();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  // 第一次使用时，让第二行左右轻轻滑一下，提示可以滑动
  useEffect(() => {
    let seen = true;
    try {
      seen = localStorage.getItem(HINT_KEY) === '1';
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      /* 存不了就不提示 */
    }
    if (seen) return;
    setPeek(true);
    const t = window.setTimeout(() => setPeek(false), 2600);
    return () => window.clearTimeout(t);
  }, []);

  const amount = s.amount();

  const openTrend = useCallback(
    (code: string) => {
      // 电脑宽屏：在右侧走势栏显示；手机：弹出走势面板
      if (wide) {
        setFocusCode(code);
        setInvertPair(false);
        return;
      }
      const base = useStore.getState().active;
      const to = code !== base ? base : code === 'USD' ? 'CNY' : 'USD';
      setTrend({ from: code, to });
    },
    [wide],
  );

  const panelPair = useMemo(() => {
    const from = focusCode && visible.includes(focusCode) ? focusCode : (visible.find((c) => c !== active) ?? 'USD');
    const to = from !== active ? active : from === 'USD' ? 'CNY' : 'USD';
    return invertPair ? { from: to, to: from } : { from, to };
  }, [focusCode, visible, active, invertPair]);

  const copy = useCallback(async (code: string, text: string) => {
    const plain = text.replace(/,/g, '');
    const ok = await copyText(plain);
    useStore.getState().showToast(ok ? `已复制 ${plain} ${code}` : '无法访问剪贴板');
  }, []);

  // 电脑键盘输入
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (picker || settings || editing || swapFor || trend) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if ((e.metaKey || e.ctrlKey) && (e.key === 'c' || e.key === 'C')) {
        if (window.getSelection()?.toString()) return;
        const st = useStore.getState();
        const v = st.amount();
        if (Number.isFinite(v)) {
          e.preventDefault();
          copy(st.active, formatAmount(v, st.decimals));
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        useStore.getState().moveActive(e.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      // 和手势对应：← 查看走势（左滑），→ 更换当前货币（右滑）
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const code = useStore.getState().active;
        if (e.key === 'ArrowLeft') openTrend(code);
        else setSwapFor(code);
        return;
      }
      const k = KEYMAP[e.key];
      if (!k) return;
      // 焦点在按钮上时，回车交给按钮本身
      if (e.key === 'Enter' && t && t.tagName === 'BUTTON' && !t.classList.contains('key')) return;
      e.preventDefault();
      useStore.getState().key(k);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picker, settings, editing, swapFor, trend, copy, openTrend]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  // 普通模式：长按约 0.3 秒后上下拖动排序（横滑、竖向滚动在这之前移动了就不会触发）
  const rowSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { delay: 300, tolerance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } }),
  );
  const [sortingId, setSortingId] = useState<string | null>(null);
  const onRowDragStart = (e: DragStartEvent) => {
    gesture.sorting = true;
    setSortingId(String(e.active.id));
    navigator.vibrate?.(12);
  };
  const endRowDrag = () => {
    gesture.sorting = false;
    gesture.sortEndedAt = Date.now();
    setSortingId(null);
  };
  const onRowDragEnd = (e: DragEndEvent) => {
    endRowDrag();
    const id = String(e.active.id);
    const { over } = e;
    // 长按后没有移动就松手：复制这一行的金额
    if (Math.abs(e.delta.y) < 6 && (!over || over.id === id)) {
      const r = rows.find((x) => x.code === id);
      const v = id === active ? formatAmount(amount, decimals) : r?.value;
      if (v && v !== '—') copy(id, v);
      return;
    }
    if (!over || over.id === id) return;
    // 只在屏幕上的几行之间排序，放不下的货币保持在后面
    s.reorder([...arrayMove(visible, visible.indexOf(id), visible.indexOf(String(over.id))), ...list.slice(visible.length)]);
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active: a, over } = e;
    if (!over || a.id === over.id) return;
    const from = list.indexOf(String(a.id));
    const to = list.indexOf(String(over.id));
    s.reorder(arrayMove(list, from, to));
  };

  const rows = useMemo(() => {
    const r = rates.rates;
    const prev = rates.prev;
    return visible.map((code) => {
      const missing = !r[code];
      if (code === active) {
        const showResult = hasOperator(expr);
        return {
          code,
          missing,
          value: formatExpr(expr),
          sub: showResult ? `= ${formatAmount(amount, decimals)}` : '',
          change: null,
        };
      }
      const v = convert(amount, active, code, r);
      const per = perBase(code, active, r);
      const unit = unitFor(per);
      const pct = prev && r[active] && prev[active] && prev[code] ? changePct(per, perBase(code, active, prev)) : null;
      return {
        code,
        missing,
        value: missing ? '—' : formatAmount(v, decimals),
        sub: missing || !r[active] ? '暂无汇率' : `${unit.toLocaleString('en-US')} ${code} = ${formatRate(per * unit)} ${active}`,
        change: pct === null ? null : { text: formatPct(pct), dir: (formatPct(pct) === '0.00%' ? 'flat' : pct > 0 ? 'up' : 'down') as 'up' | 'down' | 'flat' },
      };
    });
  }, [visible, active, expr, amount, rates, decimals]);

  const live = rates.fetchedAt > 0 && status !== 'error';
  const stale = Date.now() - new Date(`${rates.date}T00:00:00Z`).getTime() > 3 * 86400_000;
  let statusText = formatDateCN(rates.date);
  if (status === 'loading') statusText += ' · 更新中';
  else if (!rates.fetchedAt) statusText += ' · 内置数据';
  else if (status === 'error') statusText += ' · 离线';
  else statusText += ` · ${formatAgo(rates.fetchedAt, now)}更新`;

  const listView = (
    <main
      ref={listRef}
      className={`list${sortingId ? ' is-sorting' : ''}${editing ? ' is-editing' : ''}`}
      style={{ '--row-h': `${rowH}px` } as CSSProperties}
      aria-label="货币列表"
      data-slots={slots}
    >
      {editing ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} modifiers={[restrictToVerticalAxis, restrictToParentElement]}>
          {list.length > slots && <p className="edit-note">这块屏幕显示前 {slots} 种，排在后面的暂时不显示。</p>}
          <SortableContext items={list} strategy={verticalListSortingStrategy}>
            <div className="edit-list">
              {list.map((code, i) => (
                <EditRow key={code} code={code} hidden={i >= slots} canRemove={list.length > 1} onRemove={() => s.remove(code)} />
              ))}
            </div>
          </SortableContext>
          <button type="button" className="add-row" onClick={() => setPicker(true)}>
            <Plus size={18} /> 添加货币
          </button>
        </DndContext>
      ) : (
        <DndContext
          sensors={rowSensors}
          collisionDetection={closestCenter}
          onDragStart={onRowDragStart}
          onDragEnd={onRowDragEnd}
          onDragCancel={endRowDrag}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        >
          <SortableContext items={visible} strategy={verticalListSortingStrategy}>
            {rows.map((r, i) => (
              <Row
                key={r.code}
                code={r.code}
                active={r.code === active}
                value={r.value}
                sub={r.sub}
                change={r.change}
                missing={r.missing}
                noSep={i === rows.length - 1 || rows[i + 1]?.code === active}
                peek={peek && i === 1}
                wide={wide}
                focus={wide && r.code === (invertPair ? panelPair.to : panelPair.from)}
                compact={compact}
                onSelect={() => s.setActive(r.code)}
                onSwap={() => setSwapFor(r.code)}
                onTrend={() => openTrend(r.code)}
                onCopy={() => {
                  const v = r.code === active ? formatAmount(amount, decimals) : r.value;
                  if (v !== '—') copy(r.code, v);
                }}
              />
            ))}
          </SortableContext>
          {visible.length < slots && (
            <button type="button" className="add-slot" onClick={() => setPicker(true)}>
              <Plus size={18} /> 添加货币
            </button>
          )}
        </DndContext>
      )}
    </main>
  );

  return (
    <div className={`app${editing ? ' is-editing' : ''}${wide ? ' is-wide' : ''}`}>
      <header className="top">
        <div className="brand">
          <span className="logo" aria-label="简汇">
            简汇
          </span>
          <button
            type="button"
            className={`status${live && !stale ? ' is-live' : ' is-cached'}`}
            onClick={() => s.refresh({ force: true })}
            title="点击更新汇率"
            aria-label={`汇率日期 ${statusText}，点击更新`}
          >
            <span className="dot" aria-hidden="true" />
            <span className="status-text">{statusText}</span>
            <RefreshCw size={13} className={status === 'loading' ? 'spin' : ''} aria-hidden="true" />
          </button>
        </div>
        <div className="actions">
          {editing ? (
            <button type="button" className="btn-done" onClick={() => s.setEditing(false)}>
              完成
            </button>
          ) : (
            <>
              <button type="button" className="icon-btn" onClick={() => setPicker(true)} aria-label="添加货币" title="添加货币">
                <Plus size={22} />
              </button>
              <button type="button" className="icon-btn" onClick={() => s.setEditing(true)} aria-label="编辑列表" title="排序和删除">
                <ArrowDownUp size={19} />
              </button>
              <button type="button" className="icon-btn" onClick={() => setSettings(true)} aria-label="设置" title="设置">
                <Settings2 size={20} />
              </button>
            </>
          )}
        </div>
      </header>

      {wide ? (
        <div className="wide-body">
          {listView}
          <aside className="side">
            <TrendPanel from={panelPair.from} to={panelPair.to} onInvert={() => setInvertPair((v) => !v)} />
            <Keypad onKey={s.key} />
          </aside>
        </div>
      ) : (
        <>
          {listView}
          {!editing && <Keypad onKey={s.key} />}
        </>
      )}

      <div className="toast-area" aria-live="polite">
        {toast && (
          <div className="toast" key={toast.id} onAnimationEnd={(e) => e.animationName === 'toast-out' && useStore.setState({ toast: null })}>
            {toast.text}
          </div>
        )}
      </div>

      <Picker open={picker} onClose={() => setPicker(false)} />
      <Picker open={!!swapFor} replace={swapFor} onClose={() => setSwapFor(null)} />
      <Trend pair={trend} onClose={() => setTrend(null)} onInvert={() => setTrend((t) => (t ? { from: t.to, to: t.from } : t))} />
      <Settings open={settings} onClose={() => setSettings(false)} />
    </div>
  );
}
