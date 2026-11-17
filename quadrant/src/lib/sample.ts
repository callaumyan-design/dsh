import { addDays } from './date';
import { uid } from './id';
import type { QuadrantId, Task } from './types';

interface Seed {
  q: QuadrantId;
  title: string;
  due?: number;
  time?: string;
  tags?: string[];
  delegate?: string;
  notes?: string;
  subtasks?: [string, boolean][];
  repeat?: Task['repeat'];
  doneDaysAgo?: number;
}

const SEEDS: Seed[] = [
  { q: 'q1', title: '修复线上支付失败的问题', due: 0, time: '18:00', tags: ['工作'], subtasks: [['复现问题', true], ['定位日志', true], ['发布修复', false]] },
  { q: 'q1', title: '提交季度汇报材料', due: 1, tags: ['工作'], notes: '重点：营收、留存、下季度计划。' },
  { q: 'q1', title: '交房租', due: 0, tags: ['生活'] },
  { q: 'q2', title: '每天读书 30 分钟', due: 0, repeat: 'daily', tags: ['成长'] },
  { q: 'q2', title: '规划下个月的健身计划', due: 2, tags: ['健康'], subtasks: [['确定目标', false], ['选好时间段', false]] },
  { q: 'q2', title: '整理个人知识库', due: 6, tags: ['成长'] },
  { q: 'q2', title: '预约年度体检', tags: ['健康'] },
  { q: 'q3', title: '回复供应商的报价邮件', due: 0, delegate: '小王', tags: ['工作'] },
  { q: 'q3', title: '帮同事打印会议资料', due: 1, delegate: '行政' },
  { q: 'q3', title: '参加部门例会', due: 2, time: '10:00', repeat: 'weekly', tags: ['工作'] },
  { q: 'q4', title: '整理手机相册', tags: ['生活'] },
  { q: 'q4', title: '刷短视频不超过 20 分钟', tags: ['习惯'] },
  // 已完成的示例，让统计页有内容
  { q: 'q1', title: '处理客户投诉', doneDaysAgo: 0, tags: ['工作'] },
  { q: 'q2', title: '写完学习笔记第 3 章', doneDaysAgo: 1, tags: ['成长'] },
  { q: 'q2', title: '晨跑 5 公里', doneDaysAgo: 2, tags: ['健康'] },
  { q: 'q1', title: '准备客户演示', doneDaysAgo: 3, tags: ['工作'] },
  { q: 'q3', title: '填写报销单', doneDaysAgo: 3 },
  { q: 'q2', title: '和家人视频通话', doneDaysAgo: 4, tags: ['生活'] },
  { q: 'q1', title: '赶合同修改', doneDaysAgo: 5, tags: ['工作'] },
  { q: 'q4', title: '清理邮箱订阅', doneDaysAgo: 6 },
  { q: 'q2', title: '学习新框架入门', doneDaysAgo: 8, tags: ['成长'] },
  { q: 'q3', title: '代收快递', doneDaysAgo: 9 },
];

export function buildSampleTasks(today: string, now = Date.now()): Task[] {
  const counters: Record<QuadrantId, number> = { q1: 0, q2: 0, q3: 0, q4: 0 };
  return SEEDS.map((s) => {
    const order = ++counters[s.q] * 1000;
    const done = s.doneDaysAgo !== undefined;
    const completedAt = done ? now - s.doneDaysAgo! * 86400000 - 3600000 : undefined;
    const task: Task = {
      id: uid(),
      title: s.title,
      notes: s.notes ?? '',
      quadrant: s.q,
      order,
      done,
      createdAt: (completedAt ?? now) - 2 * 86400000,
      updatedAt: completedAt ?? now,
      tags: s.tags ?? [],
      subtasks: (s.subtasks ?? []).map(([title, d]) => ({ id: uid(), title, done: d })),
      sample: true,
    };
    if (completedAt) task.completedAt = completedAt;
    if (s.due !== undefined) task.due = addDays(today, s.due);
    if (s.time) task.dueTime = s.time;
    if (s.delegate) task.delegate = s.delegate;
    if (s.repeat) task.repeat = s.repeat;
    return task;
  });
}
