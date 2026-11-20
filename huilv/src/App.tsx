import { useCallback, useEffect, useMemo, useState } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { ArrowDownUp, Plus, RefreshCw, Settings2 } from 'lucide-react';
import { useStore } from './store';
import { hasOperator, type Key } from './lib/calc';
import { convert, perBase } from './lib/rates';
import { changePct, formatAgo, formatAmount, formatDateCN, formatExpr, formatPct, formatRate, unitFor } from './lib/format';
import { copyText } from './lib/clipboard';
import { Row, EditRow } from './components/Row';
import { Keypad } from './components/Keypad';
import { Picker } from './components/Picker';
import { Settings } from './components/Settings';

const KEYMAP: Record<string, Key> = {
  '0': '0', '1': '1', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9',
  '.': '.', ',': '.', '+': '+', '-': '-', '*': '*', x: '*', X: '*', '/': '/', '÷': '/', '×': '*',
  Enter: '=', '=': '=', Backspace: 'back', Escape: 'clear', Delete: 'clear', c: 'clear', C: 'clear',
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
  const { list, active, expr, rates, decimals, status, editing, toast } = s;
  const [picker, setPicker] = useState(false);
  const [settings, setSettings] = useState(false);
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

  const amount = s.amount();

  const copy = useCallback(
    async (code: string, text: string) => {
      const plain = text.replace(/,/g, '');
      const ok = await copyText(plain);
      useStore.getState().showToast(ok ? `已复制 ${plain} ${code}` : '无法访问剪贴板');
    },
    [],
  );

  // 电脑键盘输入
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (picker || settings || editing) return;
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
      const k = KEYMAP[e.key];
      if (!k) return;
      // 焦点在按钮上时，回车交给按钮本身
      if (e.key === 'Enter' && t && t.tagName === 'BUTTON' && !t.classList.contains('key')) return;
      e.preventDefault();
      useStore.getState().key(k);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picker, settings, editing, copy]);

  // 切换基准货币后把那一行滚动到可见区域
  useEffect(() => {
    document.querySelector(`.row[data-code="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
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
    return list.map((code) => {
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
        change:
          pct === null
            ? null
            : { text: formatPct(pct), dir: (formatPct(pct) === '0.00%' ? 'flat' : pct > 0 ? 'up' : 'down') as 'up' | 'down' | 'flat' },
      };
    });
  }, [list, active, expr, amount, rates, decimals]);

  const live = rates.fetchedAt > 0 && status !== 'error';
  const stale = Date.now() - new Date(`${rates.date}T00:00:00Z`).getTime() > 3 * 86400_000;
  let statusText = formatDateCN(rates.date);
  if (status === 'loading') statusText += ' · 更新中';
  else if (!rates.fetchedAt) statusText += ' · 内置数据';
  else if (status === 'error') statusText += ' · 离线';
  else statusText += ` · ${formatAgo(rates.fetchedAt, now)}更新`;

  return (
    <div className={`app${editing ? ' is-editing' : ''}`}>
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

      <main className="list" aria-label="货币列表">
        {editing ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} modifiers={[restrictToVerticalAxis, restrictToParentElement]}>
            <SortableContext items={list} strategy={verticalListSortingStrategy}>
              <div className="edit-list">
                {list.map((code) => (
                  <EditRow key={code} code={code} canRemove={list.length > 1} onRemove={() => s.remove(code)} />
                ))}
              </div>
            </SortableContext>
            <button type="button" className="add-row" onClick={() => setPicker(true)}>
              <Plus size={18} /> 添加货币
            </button>
          </DndContext>
        ) : (
          rows.map((r) => (
            <Row
              key={r.code}
              code={r.code}
              active={r.code === active}
              value={r.value}
              sub={r.sub}
              change={r.change}
              missing={r.missing}
              onSelect={() => s.setActive(r.code)}
              onCopy={() => {
                const v = r.code === active ? formatAmount(amount, decimals) : r.value;
                if (v !== '—') copy(r.code, v);
              }}
            />
          ))
        )}
      </main>

      {!editing && <Keypad onKey={s.key} />}

      <div className="toast-area" aria-live="polite">
        {toast && (
          <div className="toast" key={toast.id} onAnimationEnd={(e) => e.animationName === 'toast-out' && useStore.setState({ toast: null })}>
            {toast.text}
          </div>
        )}
      </div>

      <Picker open={picker} onClose={() => setPicker(false)} />
      <Settings open={settings} onClose={() => setSettings(false)} />
    </div>
  );
}
