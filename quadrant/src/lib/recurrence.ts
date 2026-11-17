import { addDays, addMonths, weekdayOf } from './date';
import type { Repeat } from './types';

export const REPEAT_LABEL: Record<Repeat, string> = {
  daily: '每天',
  weekdays: '每个工作日',
  weekly: '每周',
  monthly: '每月',
};

function step(iso: string, repeat: Repeat): string {
  switch (repeat) {
    case 'daily':
      return addDays(iso, 1);
    case 'weekly':
      return addDays(iso, 7);
    case 'monthly':
      return addMonths(iso, 1);
    case 'weekdays': {
      let next = addDays(iso, 1);
      while (weekdayOf(next) === 0 || weekdayOf(next) === 6) next = addDays(next, 1);
      return next;
    }
  }
}

/**
 * 计算重复任务的下一次截止日期。
 * 以原截止日期为基准推进；若推进后仍早于今天，则继续推进，避免生成一串过期任务。
 */
export function nextDue(due: string | undefined, repeat: Repeat, today: string): string {
  let next = step(due ?? today, repeat);
  let guard = 0;
  while (next < today && guard++ < 1000) next = step(next, repeat);
  return next;
}
