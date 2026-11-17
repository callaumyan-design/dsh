import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowUpRight,
  CalendarClock,
  Copy,
  Ellipsis,
  GripVertical,
  ListChecks,
  Repeat,
  StickyNote,
  Trash2,
  UserRound,
} from 'lucide-react';
import { memo, useCallback, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from 'react';
import { deleteTask, duplicateTask, moveTask, toggleTask } from '../actions';
import { diffDays, dueStatus, formatDue, toISODate } from '../lib/date';
import { QUADRANTS, isQuadrantId } from '../lib/quadrants';
import type { QuadrantId, Task } from '../lib/types';
import { openTasksOf, useStore } from '../store/useStore';
import { useUI } from '../store/useUI';
import { Checkbox, Popover } from './ui';

export interface CardProps {
  task: Task;
  today: string;
  escalateDays: number;
  compact?: boolean;
}

function completedLabel(ts: number, today: string): string {
  const d = new Date(ts);
  const iso = toISODate(d);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${formatDue(iso, today)} ${hm} 完成`;
}

export function shouldEscalate(task: Task, today: string, days: number): boolean {
  return task.quadrant === 'q2' && !task.done && !!task.due && diffDays(today, task.due) <= days;
}

export function CardMeta({ task, today, escalateDays, inline }: CardProps & { inline?: boolean }) {
  const setTagFilter = useUI((s) => s.setTagFilter);
  const status = task.done ? 'none' : dueStatus(task.due, today, 2);
  const subDone = task.subtasks.filter((s) => s.done).length;
  const items = [];
  if (task.done && task.completedAt) {
    items.push(
      <span key="done" className="meta-item">
        {completedLabel(task.completedAt, today)}
      </span>,
    );
  } else if (task.due) {
    items.push(
      <span key="due" className={`meta-item due due-${status}`}>
        <CalendarClock aria-hidden />
        {status === 'overdue' ? `逾期 · ${formatDue(task.due, today, task.dueTime)}` : formatDue(task.due, today, task.dueTime)}
      </span>,
    );
  }
  if (task.repeat && !task.done)
    items.push(
      <span key="rep" className="meta-item" title="重复任务">
        <Repeat aria-hidden />
      </span>,
    );
  if (task.subtasks.length)
    items.push(
      <span key="sub" className={`meta-item${subDone === task.subtasks.length ? ' is-full' : ''}`} title="子任务">
        <ListChecks aria-hidden />
        {subDone}/{task.subtasks.length}
      </span>,
    );
  if (task.delegate)
    items.push(
      <span key="del" className="meta-item" title="委托给">
        <UserRound aria-hidden />
        {task.delegate}
      </span>,
    );
  if (task.notes.trim())
    items.push(
      <span key="note" className="meta-item" title="有备注">
        <StickyNote aria-hidden />
      </span>,
    );
  for (const tag of task.tags)
    items.push(
      <button
        key={`t-${tag}`}
        type="button"
        className="meta-tag"
        onClick={(e) => {
          e.stopPropagation();
          setTagFilter(tag);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        title={`只看 #${tag}`}
      >
        #{tag}
      </button>,
    );
  const escalate = shouldEscalate(task, today, escalateDays);
  if (!items.length && !escalate) return null;
  return (
    <div className={`card-meta${inline ? ' is-inline' : ''}`}>
      {items}
      {escalate && (
        <button
          type="button"
          className="escalate"
          onClick={(e) => {
            e.stopPropagation();
            moveTask(task.id, 'q1');
          }}
          onPointerDown={(e) => e.stopPropagation()}
          title="截止日期临近，建议移到“立即做”"
        >
          <ArrowUpRight aria-hidden />
          升到 Q1
        </button>
      )}
    </div>
  );
}

export function TaskMenu({ task, onClose, anchor }: { task: Task; onClose: () => void; anchor: RefObject<HTMLElement | null> }) {
  const run = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose();
    fn();
  };
  return (
    <Popover anchor={anchor} onClose={onClose}>
      <div className="menu-label">移动到</div>
      <div className="menu-quads">
        {QUADRANTS.map((q) => (
          <button
            key={q.id}
            role="menuitem"
            type="button"
            className={`menu-quad q-${q.id}`}
            disabled={q.id === task.quadrant}
            onClick={run(() => moveTask(task.id, q.id))}
          >
            <b>{q.code}</b>
            {q.verb}
          </button>
        ))}
      </div>
      <div className="menu-sep" />
      <button role="menuitem" type="button" className="menu-item" onClick={run(() => duplicateTask(task.id))}>
        <Copy aria-hidden />
        创建副本
      </button>
      <button role="menuitem" type="button" className="menu-item is-danger" onClick={run(() => deleteTask(task.id))}>
        <Trash2 aria-hidden />
        删除
      </button>
    </Popover>
  );
}

/** 卡片上的键盘操作：Enter 打开、空格完成、1–4 移动、Delete 删除、D 复制 */
export function cardKeyHandler(task: Task, open: () => void) {
  return (e: KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget || e.metaKey || e.ctrlKey) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const up = e.key === 'ArrowUp';
      if (e.altKey && !task.done) {
        // Alt + ↑/↓：在象限内调整顺序
        const list = openTasksOf(useStore.getState().tasks, task.quadrant);
        const i = list.findIndex((t) => t.id === task.id);
        const j = up ? i - 1 : i + 1;
        if (i >= 0 && j >= 0 && j < list.length) moveTask(task.id, task.quadrant, j, true);
        return;
      }
      // ↑/↓：在卡片之间移动焦点
      const cards = [...(e.currentTarget.closest('.quad, .agenda')?.querySelectorAll<HTMLElement>('.card[tabindex], .agenda-row[tabindex]') ?? [])];
      const idx = cards.indexOf(e.currentTarget);
      cards[up ? idx - 1 : idx + 1]?.focus();
      return;
    }
    if (e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'enter') open();
    else if (k === ' ' || k === 'x') toggleTask(task.id);
    else if (k === 'delete' || k === 'backspace') deleteTask(task.id);
    else if (k === 'd') duplicateTask(task.id);
    else if (['1', '2', '3', '4'].includes(k) && isQuadrantId(`q${k}`)) moveTask(task.id, `q${k}` as QuadrantId);
    else return;
    e.preventDefault();
  };
}

interface SortableCardProps extends CardProps {
  dragDisabled?: boolean;
}

export const SortableTaskCard = memo(function SortableTaskCard({ task, today, escalateDays, compact, dragDisabled }: SortableCardProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { quadrant: task.quadrant },
    disabled: dragDisabled,
  });
  const openTask = useUI((s) => s.openTask);
  const isOpen = useUI((s) => s.openTaskId === task.id);
  const [menu, setMenu] = useState(false);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const pointerListeners = (listeners ?? {}) as Record<string, (e: unknown) => void>;
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  };
  const open = () => openTask(task.id);
  const closeMenu = useCallback(() => setMenu(false), []);
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`card q-${task.quadrant}${isDragging ? ' is-placeholder' : ''}${isOpen ? ' is-open' : ''}${compact ? ' is-compact' : ''}${menu ? ' has-menu' : ''}`}
      data-task-id={task.id}
      tabIndex={0}
      role="button"
      aria-roledescription="可拖动任务"
      aria-label={`${task.title}${task.due ? `，截止 ${formatDue(task.due, today, task.dueTime)}` : ''}`}
      onClick={open}
      onKeyDown={cardKeyHandler(task, open)}
      {...pointerListeners}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className="grip"
        aria-hidden
        {...attributes}
        role="presentation"
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        <GripVertical aria-hidden />
      </button>
      <Checkbox checked={false} onChange={() => toggleTask(task.id)} quadrant={task.quadrant} label={`完成“${task.title}”`} />
      <div className="card-main">
        <div className="card-title">{task.title}</div>
        <CardMeta task={task} today={today} escalateDays={escalateDays} />
      </div>
      <div className="card-actions">
        <button
          ref={menuBtn}
          type="button"
          className="icon-btn sm"
          aria-label="更多操作"
          aria-haspopup="menu"
          aria-expanded={menu}
          onClick={(e) => {
            e.stopPropagation();
            setMenu((v) => !v);
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Ellipsis />
        </button>
        {menu && <TaskMenu task={task} anchor={menuBtn} onClose={closeMenu} />}
      </div>
    </li>
  );
});

export function OverlayCard({ task, today, escalateDays, compact }: CardProps) {
  return (
    <div className={`card q-${task.quadrant} is-overlay${compact ? ' is-compact' : ''}`}>
      <span className="grip" aria-hidden>
        <GripVertical />
      </span>
      <Checkbox checked={false} onChange={() => undefined} quadrant={task.quadrant} label="" />
      <div className="card-main">
        <div className="card-title">{task.title}</div>
        <CardMeta task={task} today={today} escalateDays={escalateDays} />
      </div>
    </div>
  );
}

export const DoneCard = memo(function DoneCard({ task, today, escalateDays, compact }: CardProps) {
  const openTask = useUI((s) => s.openTask);
  const pop = useUI((s) => s.justCompleted === task.id);
  const open = () => openTask(task.id);
  return (
    <li
      className={`card is-done q-${task.quadrant}${compact ? ' is-compact' : ''}${pop ? ' is-fresh' : ''}`}
      tabIndex={0}
      role="button"
      aria-label={`已完成：${task.title}`}
      onClick={open}
      onKeyDown={cardKeyHandler(task, open)}
    >
      <Checkbox checked onChange={() => toggleTask(task.id)} quadrant={task.quadrant} label={`取消完成“${task.title}”`} pop={pop} />
      <div className="card-main">
        <div className="card-title">{task.title}</div>
        {!compact && <CardMeta task={task} today={today} escalateDays={escalateDays} />}
      </div>
    </li>
  );
});
