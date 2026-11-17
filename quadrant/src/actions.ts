import { formatDue, todayISO } from './lib/date';
import { QMAP } from './lib/quadrants';
import type { QuadrantId } from './lib/types';
import { useStore } from './store/useStore';
import { useUI } from './store/useUI';

/** 带撤销提示的常用操作，供卡片、抽屉、快捷键共用 */

const undoAction = { label: '撤销', run: () => useStore.getState().undo() };

export function toggleTask(id: string) {
  const res = useStore.getState().toggleDone(id);
  if (!res) return;
  const ui = useUI.getState();
  if (res.completed) {
    ui.markCompleted(id);
    setTimeout(() => useUI.getState().justCompleted === id && useUI.getState().markCompleted(null), 700);
    let text = '已完成';
    if (res.spawnedId) {
      const next = useStore.getState().tasks.find((t) => t.id === res.spawnedId);
      if (next?.due) text = `已完成，下一次：${formatDue(next.due, todayISO())}`;
    }
    ui.toast({ text, tone: 'success', action: undoAction });
  }
}

export function deleteTask(id: string) {
  const t = useStore.getState().deleteTask(id);
  if (!t) return;
  const ui = useUI.getState();
  if (ui.openTaskId === id) ui.openTask(null);
  ui.toast({ text: `已删除“${t.title.length > 14 ? t.title.slice(0, 14) + '…' : t.title}”`, action: undoAction });
}

export function moveTask(id: string, to: QuadrantId, index?: number, quiet = false) {
  const before = useStore.getState().tasks.find((t) => t.id === id);
  if (!before) return;
  useStore.getState().moveTask(id, to, index);
  if (!quiet && before.quadrant !== to) {
    useUI.getState().toast({ text: `已移到 ${QMAP[to].code} · ${QMAP[to].verb}`, action: undoAction });
  }
}

export function duplicateTask(id: string) {
  const newId = useStore.getState().duplicateTask(id);
  if (newId) useUI.getState().toast({ text: '已创建副本', action: undoAction });
  return newId;
}

export function undo() {
  if (!useStore.getState().undo()) useUI.getState().toast({ text: '没有可以撤销的操作' }, 2000);
}

export function redo() {
  if (!useStore.getState().redo()) useUI.getState().toast({ text: '没有可以重做的操作' }, 2000);
}

export function clearCompleted(q?: QuadrantId) {
  const n = useStore.getState().tasks.filter((t) => t.done && (!q || t.quadrant === q)).length;
  if (!n) {
    useUI.getState().toast({ text: '没有已完成的任务' }, 2000);
    return;
  }
  useUI.getState().askConfirm({
    title: q ? `清除 ${QMAP[q].code} 中 ${n} 项已完成任务？` : `清除全部 ${n} 项已完成任务？`,
    body: '清除后统计页将不再计入这些任务。可以用“撤销”恢复。',
    confirmLabel: '清除',
    danger: true,
    onConfirm: () => {
      useStore.getState().clearCompleted(q);
      useUI.getState().toast({ text: `已清除 ${n} 项`, action: undoAction });
    },
  });
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** 触发文件下载；在不允许下载的嵌入环境中返回 false */
export function downloadText(filename: string, text: string, type = 'application/json'): boolean {
  try {
    const blob = new Blob([text], { type: `${type};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  } catch {
    return false;
  }
}
