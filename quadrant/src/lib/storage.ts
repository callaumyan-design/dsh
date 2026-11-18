import { sanitizeColors } from './color';
import { isISODate } from './date';
import { uid } from './id';
import { isQuadrantId } from './quadrants';
import type { PersistedState, Prefs, Repeat, Subtask, Task } from './types';

export const STORAGE_KEY = 'quadrant-planner:v1';
export const SCHEMA_VERSION = 1;

export const DEFAULT_PREFS: Prefs = {
  theme: 'system',
  showCompleted: true,
  introDismissed: false,
  escalateDays: 1,
  smartParse: true,
  colors: {},
};

const REPEATS: Repeat[] = ['daily', 'weekdays', 'weekly', 'monthly'];

function str(v: unknown, max = 2000): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function sanitizeSubtask(v: unknown): Subtask | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const title = str(o.title, 500).trim();
  if (!title) return null;
  return { id: str(o.id, 100) || uid(), title, done: !!o.done };
}

/** 校验并规范化一条任务，用于加载本地数据和导入 */
export function sanitizeTask(v: unknown, now = Date.now()): Task | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const title = str(o.title, 500).trim();
  if (!title) return null;
  const quadrant = isQuadrantId(o.quadrant) ? o.quadrant : 'q2';
  const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
  const task: Task = {
    id: str(o.id, 100) || uid(),
    title,
    notes: str(o.notes, 20000),
    quadrant,
    order: num(o.order, now),
    done: !!o.done,
    createdAt: num(o.createdAt, now),
    updatedAt: num(o.updatedAt, now),
    tags: Array.isArray(o.tags)
      ? [...new Set(o.tags.map((t) => str(t, 40).trim()).filter(Boolean))].slice(0, 20)
      : [],
    subtasks: Array.isArray(o.subtasks)
      ? o.subtasks.map(sanitizeSubtask).filter((s): s is Subtask => !!s).slice(0, 100)
      : [],
  };
  if (task.done) task.completedAt = num(o.completedAt, task.updatedAt);
  if (isISODate(o.due)) task.due = o.due;
  if (typeof o.dueTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(o.dueTime) && task.due) task.dueTime = o.dueTime;
  if (REPEATS.includes(o.repeat as Repeat)) task.repeat = o.repeat as Repeat;
  const delegate = str(o.delegate, 60).trim();
  if (delegate) task.delegate = delegate;
  if (o.sample) task.sample = true;
  return task;
}

export function sanitizePrefs(v: unknown): Prefs {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return {
    theme: o.theme === 'light' || o.theme === 'dark' ? o.theme : 'system',
    showCompleted: typeof o.showCompleted === 'boolean' ? o.showCompleted : DEFAULT_PREFS.showCompleted,
    introDismissed: !!o.introDismissed,
    escalateDays:
      typeof o.escalateDays === 'number' && o.escalateDays >= 0 && o.escalateDays <= 14
        ? Math.round(o.escalateDays)
        : DEFAULT_PREFS.escalateDays,
    smartParse: typeof o.smartParse === 'boolean' ? o.smartParse : DEFAULT_PREFS.smartParse,
    colors: sanitizeColors(o.colors),
  };
}

export function sanitizeTasks(list: unknown): Task[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: Task[] = [];
  for (const item of list) {
    const t = sanitizeTask(item);
    if (!t) continue;
    if (seen.has(t.id)) t.id = uid();
    seen.add(t.id);
    out.push(t);
  }
  return out;
}

export function loadState(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<PersistedState>;
    return {
      version: SCHEMA_VERSION,
      tasks: sanitizeTasks(data.tasks),
      prefs: sanitizePrefs(data.prefs),
    };
  } catch {
    return null;
  }
}

export function saveState(state: PersistedState): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export interface ExportFile {
  app: 'quadrant-planner';
  version: number;
  exportedAt: string;
  tasks: Task[];
}

export function buildExport(tasks: Task[]): string {
  const file: ExportFile = {
    app: 'quadrant-planner',
    version: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    tasks,
  };
  return JSON.stringify(file, null, 2);
}

/** 解析导入的 JSON：支持本应用导出格式，也接受纯任务数组 */
export function parseImport(text: string): { tasks: Task[]; skipped: number } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('不是有效的 JSON 文件，请选择从本应用导出的备份文件。');
  }
  const list = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as ExportFile).tasks)
      ? (data as ExportFile).tasks
      : null;
  if (!list) throw new Error('文件里没有找到任务列表（tasks）。');
  const tasks = sanitizeTasks(list);
  return { tasks, skipped: list.length - tasks.length };
}

export function buildMarkdown(tasks: Task[], quadrants: { id: string; code: string; title: string; verb: string }[]): string {
  const lines: string[] = ['# 四象限任务清单', ''];
  for (const q of quadrants) {
    const list = tasks.filter((t) => t.quadrant === q.id).sort((a, b) => Number(a.done) - Number(b.done) || a.order - b.order);
    lines.push(`## ${q.code} ${q.title} · ${q.verb}`, '');
    if (!list.length) lines.push('_暂无任务_');
    for (const t of list) {
      const meta = [t.due ? `📅 ${t.due}${t.dueTime ? ' ' + t.dueTime : ''}` : '', t.delegate ? `@${t.delegate}` : '', ...t.tags.map((x) => `#${x}`)]
        .filter(Boolean)
        .join(' ');
      lines.push(`- [${t.done ? 'x' : ' '}] ${t.title}${meta ? ' ' + meta : ''}`);
      for (const s of t.subtasks) lines.push(`  - [${s.done ? 'x' : ' '}] ${s.title}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
