import { describe, expect, it } from 'vitest';
import { addMonths, diffDays, dueStatus, formatDue, startOfWeek } from './date';
import { parseQuickInput } from './parse';
import { nextDue } from './recurrence';
import { computeStats } from './stats';
import { parseImport, sanitizeTask } from './storage';
import type { Task } from './types';

// 2026-11-17 是周二
const TODAY = '2026-11-17';

describe('date', () => {
  it('计算周一与日期差', () => {
    expect(startOfWeek(TODAY)).toBe('2026-11-16');
    expect(startOfWeek('2026-11-22')).toBe('2026-11-16'); // 周日归属本周
    expect(diffDays(TODAY, '2026-11-20')).toBe(3);
  });
  it('月末加一个月不溢出', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  });
  it('格式化相对日期', () => {
    expect(formatDue(TODAY, TODAY)).toBe('今天');
    expect(formatDue('2026-11-18', TODAY, '09:00')).toBe('明天 09:00');
    expect(formatDue('2026-11-20', TODAY)).toBe('周五');
    expect(formatDue('2026-12-25', TODAY)).toBe('12月25日');
    expect(formatDue('2027-01-02', TODAY)).toBe('2027年1月2日');
  });
  it('截止状态', () => {
    expect(dueStatus('2026-11-16', TODAY)).toBe('overdue');
    expect(dueStatus(TODAY, TODAY)).toBe('today');
    expect(dueStatus('2026-11-18', TODAY, 1)).toBe('soon');
    expect(dueStatus('2026-11-25', TODAY)).toBe('later');
    expect(dueStatus(undefined, TODAY)).toBe('none');
  });
});

describe('parseQuickInput', () => {
  it('识别标签、委托人、象限', () => {
    const r = parseQuickInput('回复邮件 #工作 #客户 @小王 !3', TODAY);
    expect(r.title).toBe('回复邮件');
    expect(r.tags).toEqual(['工作', '客户']);
    expect(r.delegate).toBe('小王');
    expect(r.quadrant).toBe('q3');
  });
  it('!重要 !紧急 组合为象限', () => {
    expect(parseQuickInput('写方案 !重要', TODAY).quadrant).toBe('q2');
    expect(parseQuickInput('写方案 !重要 !紧急', TODAY).quadrant).toBe('q1');
    expect(parseQuickInput('接电话 ！紧急', TODAY).quadrant).toBe('q3');
  });
  it('识别相对日期与时间', () => {
    expect(parseQuickInput('明天下午3点开会', TODAY)).toMatchObject({ title: '开会', due: '2026-11-18', dueTime: '15:00' });
    expect(parseQuickInput('后天 9:30 面试', TODAY)).toMatchObject({ title: '面试', due: '2026-11-19', dueTime: '09:30' });
    expect(parseQuickInput('今晚8点半 健身', TODAY)).toMatchObject({ due: TODAY, dueTime: '20:30' });
    expect(parseQuickInput('3天后交稿', TODAY).due).toBe('2026-11-20');
  });
  it('识别星期', () => {
    expect(parseQuickInput('周五 提交周报', TODAY).due).toBe('2026-11-20');
    expect(parseQuickInput('周一 例会', TODAY).due).toBe('2026-11-23'); // 本周一已过，取下周一
    expect(parseQuickInput('下周三 复盘', TODAY).due).toBe('2026-11-25');
    expect(parseQuickInput('周末大扫除', TODAY).due).toBe('2026-11-21');
  });
  it('识别具体日期', () => {
    expect(parseQuickInput('12月1日 体检', TODAY).due).toBe('2026-12-01');
    expect(parseQuickInput('1月5号 年会', TODAY).due).toBe('2027-01-05'); // 已过的月份视为明年
    expect(parseQuickInput('交报告 2027-03-08', TODAY).due).toBe('2027-03-08');
    expect(parseQuickInput('11/30 结项', TODAY).due).toBe('2026-11-30');
  });
  it('识别重复规则', () => {
    expect(parseQuickInput('每天背单词', TODAY)).toMatchObject({ title: '背单词', repeat: 'daily', due: TODAY });
    expect(parseQuickInput('每周一 周会', TODAY)).toMatchObject({ repeat: 'weekly', due: '2026-11-23' });
    expect(parseQuickInput('每月15号 还信用卡', TODAY)).toMatchObject({ repeat: 'monthly', due: '2026-12-15' });
    expect(parseQuickInput('每个工作日 站会', TODAY).repeat).toBe('weekdays');
  });
  it('普通文本保持不变', () => {
    const r = parseQuickInput('读完《原则》', TODAY);
    expect(r.title).toBe('读完《原则》');
    expect(r.tokens).toHaveLength(0);
  });
});

describe('nextDue', () => {
  it('按规则推进', () => {
    expect(nextDue(TODAY, 'daily', TODAY)).toBe('2026-11-18');
    expect(nextDue(TODAY, 'weekly', TODAY)).toBe('2026-11-24');
    expect(nextDue('2026-01-31', 'monthly', '2026-01-31')).toBe('2026-02-28');
    expect(nextDue('2026-11-20', 'weekdays', TODAY)).toBe('2026-11-23'); // 周五 → 下周一
  });
  it('过期很久的重复任务不会生成过去的日期', () => {
    expect(nextDue('2026-11-01', 'daily', TODAY)).toBe(TODAY);
    expect(nextDue('2026-10-01', 'weekly', TODAY) >= TODAY).toBe(true);
  });
});

describe('storage', () => {
  it('清洗非法字段', () => {
    const t = sanitizeTask({ title: '  hi ', quadrant: 'q9', due: '2026-02-30', tags: ['a', 'a', ''], repeat: 'yearly' });
    expect(t).toMatchObject({ title: 'hi', quadrant: 'q2', tags: ['a'] });
    expect(t?.due).toBeUndefined();
    expect(t?.repeat).toBeUndefined();
    expect(sanitizeTask({ title: '' })).toBeNull();
  });
  it('导入时报告跳过的条目', () => {
    const r = parseImport(JSON.stringify({ tasks: [{ title: 'a', quadrant: 'q1' }, { foo: 1 }] }));
    expect(r.tasks).toHaveLength(1);
    expect(r.skipped).toBe(1);
    expect(() => parseImport('not json')).toThrow();
  });
});

describe('stats', () => {
  it('统计未完成、逾期与连续天数', () => {
    const now = new Date(2026, 10, 17, 12).getTime();
    const base = { notes: '', tags: [], subtasks: [], createdAt: now, updatedAt: now, order: 1 };
    const tasks: Task[] = [
      { ...base, id: '1', title: 'a', quadrant: 'q1', done: false, due: '2026-11-15' },
      { ...base, id: '2', title: 'b', quadrant: 'q2', done: false, due: TODAY },
      { ...base, id: '3', title: 'c', quadrant: 'q2', done: true, completedAt: now },
      { ...base, id: '4', title: 'd', quadrant: 'q3', done: true, completedAt: now - 86400000 },
    ];
    const s = computeStats(tasks, TODAY);
    expect(s.open).toEqual({ q1: 1, q2: 1, q3: 0, q4: 0 });
    expect(s.overdue).toBe(1);
    expect(s.dueToday).toBe(1);
    expect(s.doneToday).toBe(1);
    expect(s.streak).toBe(2);
    expect(s.daily.at(-1)?.counts.q2).toBe(1);
  });
});
