import { CalendarPlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toggleTask } from '../actions';
import { addDays, diffDays, formatDateLong } from '../lib/date';
import { QMAP } from '../lib/quadrants';
import type { Task } from '../lib/types';
import { useStore } from '../store/useStore';
import { useUI } from '../store/useUI';
import { matchesFilter } from './Matrix';
import { CardMeta, cardKeyHandler } from './TaskCard';
import { Checkbox, QBadge } from './ui';

interface Group {
  key: string;
  title: string;
  sub?: string;
  tone?: 'danger' | 'today';
  tasks: Task[];
  addDue?: string;
}

const Q_RANK = { q1: 0, q2: 1, q3: 2, q4: 3 } as const;

function sortTasks(a: Task, b: Task) {
  const ad = `${a.due ?? '9999'} ${a.dueTime ?? '99:99'}`;
  const bd = `${b.due ?? '9999'} ${b.dueTime ?? '99:99'}`;
  if (ad !== bd) return ad < bd ? -1 : 1;
  return Q_RANK[a.quadrant] - Q_RANK[b.quadrant] || a.order - b.order;
}

export function AgendaView({ today }: { today: string }) {
  const tasks = useStore((s) => s.tasks);
  const escalateDays = useStore((s) => s.prefs.escalateDays);
  const search = useUI((s) => s.search.trim());
  const tagFilter = useUI((s) => s.tagFilter);
  const openTask = useUI((s) => s.openTask);
  const openDialog = useUI((s) => s.openDialog);
  const [showUndated, setShowUndated] = useState(true);

  const groups = useMemo<Group[]>(() => {
    const open = tasks.filter((t) => !t.done && matchesFilter(t, search, tagFilter)).sort(sortTasks);
    const g: Group[] = [
      { key: 'overdue', title: '已逾期', tone: 'danger', tasks: [] },
      { key: 'today', title: '今天', sub: formatDateLong(today), tone: 'today', tasks: [], addDue: today },
      { key: 'tomorrow', title: '明天', sub: formatDateLong(addDays(today, 1)), tasks: [], addDue: addDays(today, 1) },
      { key: 'week', title: '未来 7 天', tasks: [] },
      { key: 'later', title: '更晚', tasks: [] },
      { key: 'none', title: '未设日期', tasks: [] },
    ];
    const at = (k: string) => g.find((x) => x.key === k)!;
    for (const t of open) {
      if (!t.due) at('none').tasks.push(t);
      else {
        const d = diffDays(today, t.due);
        if (d < 0) at('overdue').tasks.push(t);
        else if (d === 0) at('today').tasks.push(t);
        else if (d === 1) at('tomorrow').tasks.push(t);
        else if (d <= 7) at('week').tasks.push(t);
        else at('later').tasks.push(t);
      }
    }
    // 未设日期按象限优先级排列
    at('none').tasks.sort((a, b) => Q_RANK[a.quadrant] - Q_RANK[b.quadrant] || a.order - b.order);
    return g.filter((x) => x.tasks.length || x.key === 'today');
  }, [tasks, search, tagFilter, today]);

  const total = groups.reduce((s, g) => s + g.tasks.length, 0);

  return (
    <div className="agenda">
      <div className="agenda-inner">
        {total === 0 && <p className="empty-note">没有待办任务。去矩阵里添加一些吧。</p>}
        {groups.map((g) => {
          const collapsed = g.key === 'none' && !showUndated;
          return (
            <section key={g.key} className={`agenda-group${g.tone ? ` tone-${g.tone}` : ''}`}>
              <header className="agenda-head">
                <h2>
                  {g.title}
                  <span className="agenda-count">{g.tasks.length}</span>
                </h2>
                {g.sub && <span className="agenda-sub">{g.sub}</span>}
                <span className="spacer" />
                {g.key === 'none' && (
                  <button type="button" className="btn ghost sm" onClick={() => setShowUndated((v) => !v)}>
                    {showUndated ? '收起' : '展开'}
                  </button>
                )}
                {g.addDue && (
                  <button type="button" className="btn ghost sm" onClick={() => openDialog('add', { due: g.addDue, quadrant: 'q1' })}>
                    <CalendarPlus aria-hidden />
                    添加
                  </button>
                )}
              </header>
              {!collapsed && (
                <ul className="agenda-list">
                  {g.tasks.length === 0 && <li className="agenda-empty">今天没有截止的任务。</li>}
                  {g.tasks.map((t) => (
                    <li
                      key={t.id}
                      className={`agenda-row q-${t.quadrant}`}
                      tabIndex={0}
                      role="button"
                      aria-label={t.title}
                      onClick={() => openTask(t.id)}
                      onKeyDown={cardKeyHandler(t, () => openTask(t.id))}
                    >
                      <Checkbox checked={false} onChange={() => toggleTask(t.id)} quadrant={t.quadrant} label={`完成“${t.title}”`} />
                      <div className="agenda-main">
                        <div className="card-title">{t.title}</div>
                        <CardMeta task={t} today={today} escalateDays={escalateDays} inline />
                      </div>
                      <span title={QMAP[t.quadrant].title}>
                        <QBadge q={t.quadrant} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
