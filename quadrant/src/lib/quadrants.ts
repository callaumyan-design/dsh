import type { QuadrantId } from './types';

export interface QuadrantMeta {
  id: QuadrantId;
  code: string;
  /** 象限名称 */
  title: string;
  /** 行动策略 */
  verb: string;
  /** 英文策略，用作辅助标签 */
  verbEn: string;
  hint: string;
  important: boolean;
  urgent: boolean;
  /** 快捷键数字 */
  key: string;
}

export const QUADRANTS: QuadrantMeta[] = [
  {
    id: 'q1',
    code: 'Q1',
    title: '重要且紧急',
    verb: '立即做',
    verbEn: 'Do',
    hint: '危机、临近截止的项目、突发问题。马上亲自处理。',
    important: true,
    urgent: true,
    key: '1',
  },
  {
    id: 'q2',
    code: 'Q2',
    title: '重要但不紧急',
    verb: '计划做',
    verbEn: 'Schedule',
    hint: '长期目标、学习成长、预防性工作。给它排上日程。',
    important: true,
    urgent: false,
    key: '2',
  },
  {
    id: 'q3',
    code: 'Q3',
    title: '紧急但不重要',
    verb: '委托做',
    verbEn: 'Delegate',
    hint: '打断、部分会议与消息、别人的急事。尽量交给他人或批量处理。',
    important: false,
    urgent: true,
    key: '3',
  },
  {
    id: 'q4',
    code: 'Q4',
    title: '不重要也不紧急',
    verb: '减少做',
    verbEn: 'Eliminate',
    hint: '消遣、琐事、无意义的忙碌。能删就删。',
    important: false,
    urgent: false,
    key: '4',
  },
];

export const QUADRANT_IDS: QuadrantId[] = ['q1', 'q2', 'q3', 'q4'];

export const QMAP: Record<QuadrantId, QuadrantMeta> = Object.fromEntries(
  QUADRANTS.map((q) => [q.id, q]),
) as Record<QuadrantId, QuadrantMeta>;

export function quadrantOf(important: boolean, urgent: boolean): QuadrantId {
  if (important && urgent) return 'q1';
  if (important) return 'q2';
  if (urgent) return 'q3';
  return 'q4';
}

export function isQuadrantId(v: unknown): v is QuadrantId {
  return v === 'q1' || v === 'q2' || v === 'q3' || v === 'q4';
}
