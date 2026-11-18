export type QuadrantId = 'q1' | 'q2' | 'q3' | 'q4';

export type Repeat = 'daily' | 'weekdays' | 'weekly' | 'monthly';

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

export interface Task {
  id: string;
  title: string;
  notes: string;
  quadrant: QuadrantId;
  /** 象限内排序，数值越小越靠前 */
  order: number;
  done: boolean;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  /** 截止日期 YYYY-MM-DD（本地时间） */
  due?: string;
  /** 截止时间 HH:mm，可选 */
  dueTime?: string;
  tags: string[];
  subtasks: Subtask[];
  repeat?: Repeat;
  /** 委托给谁（第三象限常用） */
  delegate?: string;
  /** 示例数据标记 */
  sample?: boolean;
}

export type ThemePref = 'system' | 'light' | 'dark';
export type View = 'matrix' | 'agenda' | 'stats';

export interface Prefs {
  theme: ThemePref;
  showCompleted: boolean;
  introDismissed: boolean;
  /** 截止日在 N 天内的第二象限任务会提示“建议升级为立即做” */
  escalateDays: number;
  /** 快速输入时自动识别日期、标签等 */
  smartParse: boolean;
  /** 自定义象限颜色（#rrggbb），未设置的象限使用默认配色 */
  colors: Partial<Record<QuadrantId, string>>;
}

export interface PersistedState {
  version: number;
  tasks: Task[];
  prefs: Prefs;
}
