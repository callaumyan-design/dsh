import { create } from 'zustand';
import { todayISO } from '../lib/date';
import { uid } from '../lib/id';
import { QUADRANT_IDS } from '../lib/quadrants';
import { nextDue } from '../lib/recurrence';
import { buildSampleTasks } from '../lib/sample';
import { DEFAULT_PREFS, SCHEMA_VERSION, loadState, saveState } from '../lib/storage';
import type { Prefs, QuadrantId, Task } from '../lib/types';

const HISTORY_LIMIT = 60;
const ORDER_GAP = 1000;

export type NewTask = Partial<Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'order' | 'done'>> & {
  title: string;
  quadrant: QuadrantId;
};

interface DataState {
  tasks: Task[];
  prefs: Prefs;
  past: Task[][];
  future: Task[][];
  /** 合并连续编辑的撤销记录 */
  lastCommitKey?: string;
  lastCommitAt?: number;

  addTask: (input: NewTask, where?: 'top' | 'bottom') => string;
  updateTask: (id: string, patch: Partial<Task>, coalesce?: boolean) => void;
  toggleDone: (id: string) => { completed: boolean; spawnedId?: string } | null;
  deleteTask: (id: string) => Task | null;
  duplicateTask: (id: string) => string | null;
  moveTask: (id: string, to: QuadrantId, index?: number) => void;
  sortQuadrantByDue: (q: QuadrantId) => void;
  clearCompleted: (q?: QuadrantId) => number;
  importTasks: (tasks: Task[], mode: 'merge' | 'replace') => number;
  loadSamples: () => void;
  removeSamples: () => number;
  resetAll: () => void;
  undo: () => boolean;
  redo: () => boolean;
  setPrefs: (patch: Partial<Prefs>) => void;
  replaceFromStorage: () => void;
}

/** 某象限内未完成任务，按手动顺序 */
export function openTasksOf(tasks: Task[], q: QuadrantId): Task[] {
  return tasks.filter((t) => t.quadrant === q && !t.done).sort((a, b) => a.order - b.order);
}

export function doneTasksOf(tasks: Task[], q: QuadrantId): Task[] {
  return tasks
    .filter((t) => t.quadrant === q && t.done)
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
}

/** 计算插入到 list 第 index 位时的排序值 */
export function orderAt(list: Task[], index: number): number {
  if (!list.length) return ORDER_GAP;
  if (index <= 0) return list[0].order - ORDER_GAP;
  if (index >= list.length) return list[list.length - 1].order + ORDER_GAP;
  return (list[index - 1].order + list[index].order) / 2;
}

/** 间隔过小时重新编号，避免浮点精度耗尽 */
function normalize(tasks: Task[]): Task[] {
  let needs = false;
  for (const q of QUADRANT_IDS) {
    const list = openTasksOf(tasks, q);
    for (let i = 1; i < list.length; i++) {
      if (list[i].order - list[i - 1].order < 1e-6) needs = true;
    }
  }
  if (!needs) return tasks;
  const newOrder = new Map<string, number>();
  for (const q of QUADRANT_IDS) openTasksOf(tasks, q).forEach((t, i) => newOrder.set(t.id, (i + 1) * ORDER_GAP));
  return tasks.map((t) => (newOrder.has(t.id) ? { ...t, order: newOrder.get(t.id)! } : t));
}

function initial(): Pick<DataState, 'tasks' | 'prefs'> {
  const saved = loadState();
  if (saved) return { tasks: saved.tasks, prefs: saved.prefs };
  return { tasks: buildSampleTasks(todayISO()), prefs: { ...DEFAULT_PREFS } };
}

export const useStore = create<DataState>()((set, get) => {
  /** 记录撤销快照后写入新任务列表 */
  const commit = (next: Task[], key?: string) => {
    const s = get();
    const now = Date.now();
    const merge = !!key && s.lastCommitKey === key && now - (s.lastCommitAt ?? 0) < 2000;
    set({
      tasks: normalize(next),
      past: merge ? s.past : [...s.past, s.tasks].slice(-HISTORY_LIMIT),
      future: [],
      lastCommitKey: key,
      lastCommitAt: now,
    });
  };

  return {
    ...initial(),
    past: [],
    future: [],

    addTask: (input, where = 'bottom') => {
      const now = Date.now();
      const list = openTasksOf(get().tasks, input.quadrant);
      const task: Task = {
        notes: '',
        tags: [],
        subtasks: [],
        ...input,
        title: input.title.trim(),
        id: uid(),
        order: orderAt(list, where === 'top' ? 0 : list.length),
        done: false,
        createdAt: now,
        updatedAt: now,
      };
      if (!task.due) delete task.dueTime;
      commit([...get().tasks, task]);
      return task.id;
    },

    updateTask: (id, patch, coalesce = false) => {
      const tasks = get().tasks;
      const idx = tasks.findIndex((t) => t.id === id);
      if (idx < 0) return;
      const prev = tasks[idx];
      let updated: Task = { ...prev, ...patch, updatedAt: Date.now() };
      if (patch.quadrant && patch.quadrant !== prev.quadrant && patch.order === undefined) {
        updated.order = orderAt(openTasksOf(tasks, patch.quadrant), Infinity);
      }
      if (!updated.due) {
        updated = { ...updated };
        delete updated.due;
        delete updated.dueTime;
      }
      if (!updated.delegate) delete updated.delegate;
      if (!updated.repeat) delete updated.repeat;
      if (updated.sample && (patch.title !== undefined || patch.notes !== undefined)) delete updated.sample;
      const next = tasks.slice();
      next[idx] = updated;
      commit(next, coalesce ? `edit:${id}:${Object.keys(patch).join(',')}` : undefined);
    },

    toggleDone: (id) => {
      const tasks = get().tasks;
      const t = tasks.find((x) => x.id === id);
      if (!t) return null;
      const now = Date.now();
      if (t.done) {
        const list = openTasksOf(tasks, t.quadrant);
        const reopened: Task = { ...t, done: false, updatedAt: now, order: orderAt(list, list.length) };
        delete reopened.completedAt;
        commit(tasks.map((x) => (x.id === id ? reopened : x)));
        return { completed: false };
      }
      const doneTask: Task = { ...t, done: true, completedAt: now, updatedAt: now };
      const next = tasks.map((x) => (x.id === id ? doneTask : x));
      let spawnedId: string | undefined;
      if (t.repeat) {
        const today = todayISO();
        const spawned: Task = {
          ...t,
          id: uid(),
          done: false,
          due: nextDue(t.due, t.repeat, today),
          subtasks: t.subtasks.map((s) => ({ ...s, id: uid(), done: false })),
          createdAt: now,
          updatedAt: now,
        };
        delete spawned.completedAt;
        // 原任务保留为一次完成记录，不再重复
        delete doneTask.repeat;
        spawnedId = spawned.id;
        next.push(spawned);
      }
      commit(next);
      return { completed: true, spawnedId };
    },

    deleteTask: (id) => {
      const t = get().tasks.find((x) => x.id === id) ?? null;
      if (t) commit(get().tasks.filter((x) => x.id !== id));
      return t;
    },

    duplicateTask: (id) => {
      const tasks = get().tasks;
      const t = tasks.find((x) => x.id === id);
      if (!t) return null;
      const list = openTasksOf(tasks, t.quadrant);
      const at = list.findIndex((x) => x.id === id);
      const now = Date.now();
      const copy: Task = {
        ...t,
        id: uid(),
        title: `${t.title}（副本）`,
        done: false,
        order: orderAt(list, at < 0 ? list.length : at + 1),
        subtasks: t.subtasks.map((s) => ({ ...s, id: uid() })),
        createdAt: now,
        updatedAt: now,
      };
      delete copy.completedAt;
      delete copy.sample;
      commit([...tasks, copy]);
      return copy.id;
    },

    moveTask: (id, to, index) => {
      const tasks = get().tasks;
      const t = tasks.find((x) => x.id === id);
      if (!t) return;
      const list = openTasksOf(tasks, to).filter((x) => x.id !== id);
      const order = orderAt(list, index ?? list.length);
      if (t.quadrant === to && t.order === order) return;
      commit(tasks.map((x) => (x.id === id ? { ...x, quadrant: to, order, updatedAt: Date.now() } : x)));
    },

    sortQuadrantByDue: (q) => {
      const tasks = get().tasks;
      const list = openTasksOf(tasks, q)
        .slice()
        .sort((a, b) => {
          const ad = a.due ? `${a.due} ${a.dueTime ?? '99:99'}` : '9999';
          const bd = b.due ? `${b.due} ${b.dueTime ?? '99:99'}` : '9999';
          return ad < bd ? -1 : ad > bd ? 1 : a.order - b.order;
        });
      const map = new Map(list.map((t, i) => [t.id, (i + 1) * ORDER_GAP]));
      commit(tasks.map((t) => (map.has(t.id) ? { ...t, order: map.get(t.id)! } : t)));
    },

    clearCompleted: (q) => {
      const tasks = get().tasks;
      const next = tasks.filter((t) => !(t.done && (!q || t.quadrant === q)));
      const n = tasks.length - next.length;
      if (n) commit(next);
      return n;
    },

    importTasks: (incoming, mode) => {
      if (mode === 'replace') {
        commit(incoming);
        return incoming.length;
      }
      const existing = new Map(get().tasks.map((t) => [t.id, t]));
      for (const t of incoming) {
        const cur = existing.get(t.id);
        if (!cur || t.updatedAt >= cur.updatedAt) existing.set(t.id, t);
      }
      commit([...existing.values()]);
      return incoming.length;
    },

    loadSamples: () => {
      const tasks = get().tasks.filter((t) => !t.sample);
      commit([...tasks, ...buildSampleTasks(todayISO())]);
    },

    removeSamples: () => {
      const tasks = get().tasks;
      const next = tasks.filter((t) => !t.sample);
      const n = tasks.length - next.length;
      if (n) commit(next);
      return n;
    },

    resetAll: () => commit([]),

    undo: () => {
      const { past, tasks, future } = get();
      if (!past.length) return false;
      set({ tasks: past[past.length - 1], past: past.slice(0, -1), future: [tasks, ...future], lastCommitKey: undefined });
      return true;
    },

    redo: () => {
      const { past, tasks, future } = get();
      if (!future.length) return false;
      set({ tasks: future[0], future: future.slice(1), past: [...past, tasks], lastCommitKey: undefined });
      return true;
    },

    setPrefs: (patch) => set({ prefs: { ...get().prefs, ...patch } }),

    replaceFromStorage: () => {
      const saved = loadState();
      if (saved) set({ tasks: saved.tasks, prefs: saved.prefs, past: [], future: [] });
    },
  };
});

// ---- 持久化：变更后写入 localStorage，并在多个标签页之间同步 ----
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let lastSaved = '';

function persist() {
  const { tasks, prefs } = useStore.getState();
  const payload = JSON.stringify({ version: SCHEMA_VERSION, tasks, prefs });
  if (payload === lastSaved) return;
  lastSaved = payload;
  saveState({ version: SCHEMA_VERSION, tasks, prefs });
}

if (typeof window !== 'undefined') {
  useStore.subscribe((s, prev) => {
    if (s.tasks === prev.tasks && s.prefs === prev.prefs) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 150);
  });
  window.addEventListener('pagehide', persist);
  window.addEventListener('storage', (e) => {
    if (!e.key || !e.key.startsWith('quadrant-planner')) return;
    useStore.getState().replaceFromStorage();
    const { tasks, prefs } = useStore.getState();
    // 来自其他标签页的数据无需再写回
    lastSaved = JSON.stringify({ version: SCHEMA_VERSION, tasks, prefs });
  });
  // 首次打开（示例数据）也写入一次，刷新后保持一致
  persist();
}
