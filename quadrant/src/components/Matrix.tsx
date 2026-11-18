import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ArrowDownWideNarrow, ChevronDown, Ellipsis, Eraser, Maximize2, Minimize2, Palette, Plus } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { clearCompleted, moveTask } from '../actions';
import { useIsMobile } from '../hooks';
import { QMAP, QUADRANTS, QUADRANT_IDS } from '../lib/quadrants';
import type { QuadrantId, Task } from '../lib/types';
import { doneTasksOf, openTasksOf, useStore } from '../store/useStore';
import { useUI } from '../store/useUI';
import { QuickAdd } from './QuickAdd';
import { DoneCard, OverlayCard, SortableTaskCard } from './TaskCard';
import { CenterAxes, Popover } from './ui';

type Items = Record<QuadrantId, string[]>;

const ZONE = 'zone:';
const zoneId = (q: QuadrantId) => `${ZONE}${q}`;
const isZone = (id: UniqueIdentifier) => String(id).startsWith(ZONE);

const EMPTY_HINT: Record<QuadrantId, string> = {
  q1: '没有火烧眉毛的事。保持住。',
  q2: '长期目标、学习、健康、规划放这里，它们决定你的未来。',
  q3: '别人的急事、可批量处理的杂事放这里，想想能交给谁。',
  q4: '可有可无的事放这里，提醒自己少做或不做。',
};

export function matchesFilter(t: Task, search: string, tag: string | null): boolean {
  if (tag && !t.tags.includes(tag)) return false;
  if (!search) return true;
  const q = search.toLowerCase();
  return (
    t.title.toLowerCase().includes(q) ||
    t.notes.toLowerCase().includes(q) ||
    t.tags.some((x) => x.toLowerCase().includes(q)) ||
    (t.delegate ?? '').toLowerCase().includes(q) ||
    t.subtasks.some((s) => s.title.toLowerCase().includes(q))
  );
}

export function Matrix({ today }: { today: string }) {
  const tasks = useStore((s) => s.tasks);
  const prefs = useStore((s) => s.prefs);
  const search = useUI((s) => s.search.trim());
  const tagFilter = useUI((s) => s.tagFilter);
  const focused = useUI((s) => s.focused);
  const isMobile = useIsMobile();

  const visible = useMemo(() => tasks.filter((t) => matchesFilter(t, search, tagFilter)), [tasks, search, tagFilter]);
  const base = useMemo<Items>(() => {
    const out = {} as Items;
    for (const q of QUADRANT_IDS) out[q] = openTasksOf(visible, q).map((t) => t.id);
    return out;
  }, [visible]);
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const [items, setItems] = useState<Items | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const current = items ?? base;
  const itemsRef = useRef(current);
  itemsRef.current = current;

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );

  const findContainer = useCallback((id: UniqueIdentifier): QuadrantId | null => {
    const s = String(id);
    if (s.startsWith(ZONE)) return s.slice(ZONE.length) as QuadrantId;
    for (const q of QUADRANT_IDS) if (itemsRef.current[q].includes(s)) return q;
    return null;
  }, []);

  /** 先看指针落在哪个象限，再在象限内找最近的卡片 */
  const collision: CollisionDetection = useCallback((args) => {
    const pointer = pointerWithin(args);
    const hits = pointer.length ? pointer : rectIntersection(args);
    const zoneHit = hits.find((h) => isZone(h.id));
    const cardHit = hits.find((h) => !isZone(h.id));
    if (cardHit) return [cardHit];
    if (zoneHit) {
      const q = String(zoneHit.id).slice(ZONE.length) as QuadrantId;
      const ids = itemsRef.current[q] ?? [];
      if (ids.length) {
        const inner = closestCenter({
          ...args,
          droppableContainers: args.droppableContainers.filter((c) => ids.includes(String(c.id))),
        });
        if (inner.length) return [inner[0]];
      }
      return [zoneHit];
    }
    return hits.length ? [hits[0]] : [];
  }, []);

  const onDragStart = ({ active }: DragStartEvent) => {
    setActiveId(String(active.id));
    setItems(base);
    document.body.classList.add('is-dragging');
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const from = findContainer(active.id);
    const to = findContainer(over.id);
    if (!from || !to || from === to) return;
    setItems((prev) => {
      const p = prev ?? base;
      const fromItems = p[from].filter((id) => id !== active.id);
      const toItems = p[to].filter((id) => id !== active.id);
      let idx = toItems.length;
      if (!isZone(over.id)) {
        const overIdx = toItems.indexOf(String(over.id));
        const translated = active.rect.current.translated;
        const below = translated && translated.top > over.rect.top + over.rect.height / 2;
        idx = overIdx < 0 ? toItems.length : overIdx + (below ? 1 : 0);
      }
      toItems.splice(idx, 0, String(active.id));
      return { ...p, [from]: fromItems, [to]: toItems };
    });
  };

  const finish = () => {
    setItems(null);
    setActiveId(null);
    document.body.classList.remove('is-dragging');
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const id = String(active.id);
    const task = byId.get(id);
    if (!over || !task) return finish();
    const to = findContainer(over.id);
    if (!to) return finish();
    let list = itemsRef.current[to].slice();
    const oldIndex = list.indexOf(id);
    if (oldIndex < 0) list.push(id);
    else if (!isZone(over.id)) {
      const newIndex = list.indexOf(String(over.id));
      if (newIndex >= 0 && newIndex !== oldIndex) list = arrayMove(list, oldIndex, newIndex);
    }
    // 把可见列表中的位置换算到完整列表（考虑筛选隐藏的任务）
    const pos = list.indexOf(id);
    const full = openTasksOf(useStore.getState().tasks, to).filter((t) => t.id !== id);
    let index = full.length;
    const next = list[pos + 1];
    const prev = list[pos - 1];
    if (next) index = Math.max(0, full.findIndex((t) => t.id === next));
    else if (prev) index = full.findIndex((t) => t.id === prev) + 1;
    moveTask(id, to, index, task.quadrant === to);
    finish();
  };

  const activeTask = activeId ? byId.get(activeId) : undefined;
  const shown = focused ? [focused] : QUADRANT_IDS;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={finish}
    >
      <div className={`matrix${focused ? ' is-focused' : ' axes-grid'}`}>
        {!focused && <CenterAxes />}
        {shown.map((q) => (
          <QuadrantPanel
            key={q}
            q={q}
            ids={current[q]}
            byId={byId}
            done={prefs.showCompleted ? doneTasksOf(visible, q) : []}
            today={today}
            escalateDays={prefs.escalateDays}
            compact={isMobile && !focused}
            isMobile={isMobile}
            filtered={!!search || !!tagFilter}
            focused={focused === q}
          />
        ))}
        {focused && (
          <aside className="rail" aria-label="其他象限（可拖入）">
            {QUADRANTS.filter((m) => m.id !== focused).map((m) => (
              <RailZone key={m.id} q={m.id} count={current[m.id].length} />
            ))}
          </aside>
        )}
      </div>
      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' }}>
        {activeTask ? (
          <OverlayCard
            task={{ ...activeTask, quadrant: findContainer(activeTask.id) ?? activeTask.quadrant }}
            today={today}
            escalateDays={prefs.escalateDays}
            compact={isMobile && !focused}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function RailZone({ q, count }: { q: QuadrantId; count: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: zoneId(q) });
  const setFocused = useUI((s) => s.setFocused);
  const m = QMAP[q];
  return (
    <button
      ref={setNodeRef}
      type="button"
      className={`rail-zone q-${q}${isOver ? ' is-over' : ''}`}
      onClick={() => setFocused(q)}
      title={`切换到 ${m.code} ${m.title}，也可以把任务拖到这里`}
    >
      <span className="rail-code">{m.code}</span>
      <span className="rail-verb">{m.verb}</span>
      <span className="rail-count">{count}</span>
    </button>
  );
}

function QuadrantPanel({
  q,
  ids,
  byId,
  done,
  today,
  escalateDays,
  compact,
  isMobile,
  filtered,
  focused,
}: {
  q: QuadrantId;
  ids: string[];
  byId: Map<string, Task>;
  done: Task[];
  today: string;
  escalateDays: number;
  compact: boolean;
  isMobile: boolean;
  filtered: boolean;
  focused: boolean;
}) {
  const m = QMAP[q];
  const { setNodeRef, isOver } = useDroppable({ id: zoneId(q) });
  const setFocused = useUI((s) => s.setFocused);
  const openDialog = useUI((s) => s.openDialog);
  const sortByDue = useStore((s) => s.sortQuadrantByDue);
  const [showDone, setShowDone] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setMenu(false), []);

  const tasks = ids.map((id) => byId.get(id)).filter((t): t is Task => !!t);
  const total = tasks.length + done.length;
  const headId = `quad-${q}-title`;

  return (
    <section className={`quad q-${q}${isOver ? ' is-over' : ''}${focused ? ' is-focused' : ''}`} aria-labelledby={headId} data-quadrant={q}>
      <header className="quad-head">
        <button
          type="button"
          className="quad-title"
          onClick={() => setFocused(focused ? null : q)}
          title={focused ? '返回四象限' : `展开 ${m.code}`}
        >
          <span className="quad-code">{m.code}</span>
          <span className="quad-names">
            <span className="quad-verb" id={headId}>
              {m.verb}
            </span>
            <span className="quad-name">
              {m.title}
              <i> · {m.verbEn}</i>
            </span>
          </span>
        </button>
        <span className="quad-count" aria-label={`${tasks.length} 项未完成`}>
          {tasks.length}
        </span>
        <div className="quad-tools">
          <button type="button" className="icon-btn sm" aria-label={`添加到${m.verb}`} onClick={() => openDialog('add', { quadrant: q })}>
            <Plus />
          </button>
          {!isMobile && (
            <button
              type="button"
              className="icon-btn sm"
              aria-label={focused ? '返回四象限' : '专注此象限'}
              title={focused ? '返回四象限' : '专注此象限'}
              onClick={() => setFocused(focused ? null : q)}
            >
              {focused ? <Minimize2 /> : <Maximize2 />}
            </button>
          )}
          <button
            ref={menuBtn}
            type="button"
            className="icon-btn sm"
            aria-label="象限操作"
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => setMenu((v) => !v)}
          >
            <Ellipsis />
          </button>
          {menu && (
            <Popover anchor={menuBtn} onClose={closeMenu} width={248}>
              <button
                role="menuitem"
                type="button"
                className="menu-item"
                onClick={() => {
                  sortByDue(q);
                  closeMenu();
                }}
              >
                <ArrowDownWideNarrow aria-hidden />
                按截止日期排序
              </button>
              <button
                role="menuitem"
                type="button"
                className="menu-item"
                onClick={() => {
                  setFocused(focused ? null : q);
                  closeMenu();
                }}
              >
                {focused ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
                {focused ? '返回四象限' : '专注此象限'}
              </button>
              <button
                role="menuitem"
                type="button"
                className="menu-item"
                onClick={() => {
                  closeMenu();
                  openDialog('settings');
                  // 等设置面板渲染后滚动到颜色设置，并打开这个象限的取色器
                  setTimeout(() => {
                    document.getElementById('set-colors')?.scrollIntoView({ block: 'center' });
                    document.getElementById(`set-color-${q}`)?.focus();
                  }, 50);
                }}
              >
                <Palette aria-hidden />
                更改颜色
              </button>
              <button
                role="menuitem"
                type="button"
                className="menu-item is-danger"
                onClick={() => {
                  closeMenu();
                  clearCompleted(q);
                }}
              >
                <Eraser aria-hidden />
                清除已完成
              </button>
              <p className="menu-hint">{m.hint}</p>
            </Popover>
          )}
        </div>
      </header>
      <div className="quad-body" ref={setNodeRef}>
        <SortableContext id={q} items={ids} strategy={verticalListSortingStrategy}>
          <ul className="card-list">
            {tasks.map((t) => (
              <SortableTaskCard key={t.id} task={t} today={today} escalateDays={escalateDays} compact={compact} />
            ))}
          </ul>
        </SortableContext>
        {tasks.length === 0 && (
          <div className="quad-empty">
            {filtered ? '没有符合筛选条件的任务' : total === 0 || !compact ? EMPTY_HINT[q] : '全部完成'}
          </div>
        )}
        {done.length > 0 && (
          <div className={`done-group${showDone ? ' is-open' : ''}`}>
            <button type="button" className="done-toggle" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)}>
              <ChevronDown aria-hidden />
              已完成 {done.length}
            </button>
            {showDone && (
              <ul className="card-list">
                {done.slice(0, 50).map((t) => (
                  <DoneCard key={t.id} task={t} today={today} escalateDays={escalateDays} compact={compact} />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      {!isMobile && <QuickAdd quadrant={q} />}
    </section>
  );
}
