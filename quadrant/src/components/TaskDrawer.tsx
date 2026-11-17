import { CalendarClock, Copy, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { deleteTask, duplicateTask, toggleTask } from '../actions';
import { addDays, formatDue, startOfWeek } from '../lib/date';
import { uid } from '../lib/id';
import { QMAP } from '../lib/quadrants';
import { REPEAT_LABEL } from '../lib/recurrence';
import type { Repeat, Task } from '../lib/types';
import { useStore } from '../store/useStore';
import { useUI } from '../store/useUI';
import { Checkbox, QuadrantPicker } from './ui';

function AutoTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const { minRows = 1, ...rest } = props;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [props.value]);
  return <textarea ref={ref} rows={minRows} {...rest} />;
}

function fmtTime(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function TaskDrawer({ today }: { today: string }) {
  const openId = useUI((s) => s.openTaskId);
  const openTask = useUI((s) => s.openTask);
  const task = useStore((s) => (openId ? s.tasks.find((t) => t.id === openId) : undefined));
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openId && !task) openTask(null);
  }, [openId, task, openTask]);

  useEffect(() => {
    if (!openId) return;
    const prev = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        openTask(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (prev && document.contains(prev)) prev.focus();
    };
  }, [openId, openTask]);

  if (!task) return null;
  return (
    <div className="drawer-layer" onMouseDown={(e) => e.target === e.currentTarget && openTask(null)}>
      <div ref={panelRef} className={`drawer q-${task.quadrant}`} role="dialog" aria-modal="true" aria-label="任务详情" tabIndex={-1}>
        <DrawerContent key={task.id} task={task} today={today} onClose={() => openTask(null)} />
      </div>
    </div>
  );
}

function DrawerContent({ task, today, onClose }: { task: Task; today: string; onClose: () => void }) {
  const update = useStore((s) => s.updateTask);
  const allTasks = useStore((s) => s.tasks);
  const [title, setTitle] = useState(task.title);
  const [tagText, setTagText] = useState('');
  const [subText, setSubText] = useState('');
  const m = QMAP[task.quadrant];

  // 外部变化（撤销等）时同步标题
  useEffect(() => setTitle(task.title), [task.title]);

  const knownTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of allTasks) for (const g of t.tags) set.add(g);
    return [...set].filter((g) => !task.tags.includes(g)).slice(0, 12);
  }, [allTasks, task.tags]);

  const patch = (p: Partial<Task>, coalesce = false) => update(task.id, p, coalesce);
  const addTag = (raw: string) => {
    const tags = raw
      .split(/[,，\s]+/)
      .map((x) => x.replace(/^#/, '').trim())
      .filter(Boolean);
    if (!tags.length) return;
    patch({ tags: [...new Set([...task.tags, ...tags])].slice(0, 20) });
    setTagText('');
  };
  const addSub = () => {
    const t = subText.trim();
    if (!t) return;
    patch({ subtasks: [...task.subtasks, { id: uid(), title: t, done: false }] });
    setSubText('');
  };
  const subDone = task.subtasks.filter((s) => s.done).length;
  const quick = [
    { label: '今天', value: today },
    { label: '明天', value: addDays(today, 1) },
    { label: '下周一', value: addDays(startOfWeek(today), 7) },
  ];

  return (
    <>
      <header className="drawer-head">
        <span className={`qbadge q-${task.quadrant}`}>
          <b>{m.code}</b>
          <span>{m.verb}</span>
        </span>
        {task.done && <span className="pill success">已完成</span>}
        <span className="spacer" />
        <button type="button" className="icon-btn" aria-label="创建副本" title="创建副本" onClick={() => duplicateTask(task.id)}>
          <Copy />
        </button>
        <button type="button" className="icon-btn danger" aria-label="删除任务" title="删除" onClick={() => deleteTask(task.id)}>
          <Trash2 />
        </button>
        <button type="button" className="icon-btn" aria-label="关闭" onClick={onClose}>
          <X />
        </button>
      </header>

      <div className="drawer-body">
        <div className="drawer-title-row">
          <Checkbox
            checked={task.done}
            onChange={() => toggleTask(task.id)}
            quadrant={task.quadrant}
            label={task.done ? '标记为未完成' : '标记为完成'}
          />
          <AutoTextarea
            id="drawer-title"
            className={`drawer-title${task.done ? ' is-done' : ''}`}
            value={title}
            aria-label="任务标题"
            onChange={(e) => {
              const v = e.target.value.replace(/\n/g, ' ');
              setTitle(v);
              if (v.trim()) patch({ title: v }, true);
            }}
            onBlur={() => !title.trim() && setTitle(task.title)}
            onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
          />
        </div>

        <section className="field">
          <div className="field-label">象限</div>
          <QuadrantPicker value={task.quadrant} onChange={(q) => q !== task.quadrant && patch({ quadrant: q })} compact />
        </section>

        <section className="field">
          <div className="field-label">
            <CalendarClock aria-hidden /> 截止
          </div>
          <div className="chip-row">
            {quick.map((d) => (
              <button key={d.label} type="button" className={`chip${task.due === d.value ? ' is-on' : ''}`} onClick={() => patch({ due: d.value })}>
                {d.label}
              </button>
            ))}
            {task.due && (
              <button type="button" className="chip" onClick={() => patch({ due: undefined, dueTime: undefined, repeat: undefined })}>
                清除
              </button>
            )}
          </div>
          <div className="row-2">
            <input id="drawer-due" type="date" className="input" aria-label="截止日期" value={task.due ?? ''} onChange={(e) => patch({ due: e.target.value || undefined })} />
            <input
              id="drawer-time"
              type="time"
              className="input"
              aria-label="截止时间"
              value={task.dueTime ?? ''}
              disabled={!task.due}
              onChange={(e) => patch({ dueTime: e.target.value || undefined })}
            />
          </div>
          {task.due && <p className="field-help">{formatDue(task.due, today, task.dueTime)}</p>}
        </section>

        <div className="row-2">
          <section className="field">
            <label className="field-label" htmlFor="drawer-repeat">
              重复
            </label>
            <select
              id="drawer-repeat"
              className="input"
              value={task.repeat ?? ''}
              onChange={(e) => {
                const r = (e.target.value || undefined) as Repeat | undefined;
                patch(r && !task.due ? { repeat: r, due: today } : { repeat: r });
              }}
            >
              <option value="">不重复</option>
              {(Object.keys(REPEAT_LABEL) as Repeat[]).map((r) => (
                <option key={r} value={r}>
                  {REPEAT_LABEL[r]}
                </option>
              ))}
            </select>
          </section>
          <section className="field">
            <label className="field-label" htmlFor="drawer-delegate">
              委托给
            </label>
            <input
              id="drawer-delegate"
              className="input"
              placeholder={task.quadrant === 'q3' ? '交给谁处理？' : '可选'}
              value={task.delegate ?? ''}
              onChange={(e) => patch({ delegate: e.target.value }, true)}
            />
          </section>
        </div>

        <section className="field">
          <label className="field-label" htmlFor="drawer-tag">
            标签
          </label>
          <div className="tag-box">
            {task.tags.map((g) => (
              <span key={g} className="tag-chip">
                #{g}
                <button type="button" aria-label={`移除标签 ${g}`} onClick={() => patch({ tags: task.tags.filter((x) => x !== g) })}>
                  <X />
                </button>
              </span>
            ))}
            <input
              id="drawer-tag"
              value={tagText}
              placeholder={task.tags.length ? '' : '输入后回车添加'}
              onChange={(e) => {
                const v = e.target.value;
                if (/[,，]$/.test(v)) addTag(v);
                else setTagText(v);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addTag(tagText);
                } else if (e.key === 'Backspace' && !tagText && task.tags.length) {
                  patch({ tags: task.tags.slice(0, -1) });
                }
              }}
              onBlur={() => tagText && addTag(tagText)}
            />
          </div>
          {knownTags.length > 0 && (
            <div className="chip-row suggest">
              {knownTags.map((g) => (
                <button key={g} type="button" className="chip ghost" onClick={() => patch({ tags: [...task.tags, g] })}>
                  +#{g}
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="field">
          <div className="field-label">
            子任务
            {task.subtasks.length > 0 && (
              <span className="field-count">
                {subDone}/{task.subtasks.length}
              </span>
            )}
          </div>
          {task.subtasks.length > 0 && (
            <div className="progress" aria-hidden>
              <span style={{ width: `${(subDone / task.subtasks.length) * 100}%` }} />
            </div>
          )}
          <ul className="subtasks">
            {task.subtasks.map((s, i) => (
              <li key={s.id} className={s.done ? 'is-done' : ''}>
                <Checkbox
                  size="sm"
                  checked={s.done}
                  quadrant={task.quadrant}
                  label={s.done ? `取消完成 ${s.title}` : `完成 ${s.title}`}
                  onChange={() => patch({ subtasks: task.subtasks.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)) })}
                />
                <input
                  id={`sub-${s.id}`}
                  aria-label={`子任务 ${i + 1}`}
                  value={s.title}
                  onChange={(e) => patch({ subtasks: task.subtasks.map((x) => (x.id === s.id ? { ...x, title: e.target.value } : x)) }, true)}
                  onBlur={(e) => !e.target.value.trim() && patch({ subtasks: task.subtasks.filter((x) => x.id !== s.id) })}
                />
                <button type="button" className="icon-btn sm" aria-label={`删除子任务 ${s.title}`} onClick={() => patch({ subtasks: task.subtasks.filter((x) => x.id !== s.id) })}>
                  <X />
                </button>
              </li>
            ))}
          </ul>
          <form
            className="sub-add"
            onSubmit={(e) => {
              e.preventDefault();
              addSub();
            }}
          >
            <Plus aria-hidden />
            <input id="drawer-subtask" aria-label="添加子任务" placeholder="添加子任务，回车保存" value={subText} onChange={(e) => setSubText(e.target.value)} />
          </form>
        </section>

        <section className="field">
          <label className="field-label" htmlFor="drawer-notes">
            备注
          </label>
          <AutoTextarea
            id="drawer-notes"
            className="input notes"
            minRows={3}
            placeholder="补充信息、链接、想法…"
            value={task.notes}
            onChange={(e) => patch({ notes: e.target.value }, true)}
          />
        </section>

        <footer className="drawer-foot">
          <span>创建于 {fmtTime(task.createdAt)}</span>
          {task.completedAt && <span>完成于 {fmtTime(task.completedAt)}</span>}
          {task.done && (
            <button type="button" className="btn ghost sm" onClick={() => toggleTask(task.id)}>
              <RotateCcw aria-hidden /> 重新打开
            </button>
          )}
        </footer>
      </div>
    </>
  );
}
