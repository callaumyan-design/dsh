// 门类：新闻按门类筛选；“今日新品”和“GitHub 热榜”两个栏目也可以像门类一样关掉。
import type { Story } from './types';

export const CATEGORIES = ['数码', 'AI', '互联网', '芯片与硬件', '开发者', '科学与前沿', '商业与政策', '其他'] as const;
export const SECTIONS = ['今日新品', 'GitHub 热榜'] as const;
export const ALL_TOPICS: string[] = [...CATEGORIES, ...SECTIONS];

export const TOPIC_CLASS: Record<string, string> = {
  数码: 'c-gadget',
  AI: 'c-ai',
  互联网: 'c-web',
  芯片与硬件: 'c-chip',
  开发者: 'c-dev',
  科学与前沿: 'c-sci',
  商业与政策: 'c-biz',
};

/** 旧的期刊或没归类的新闻算“其他” */
export const categoryOf = (s: Story): string => (s.category && (CATEGORIES as readonly string[]).includes(s.category) ? s.category : '其他');

/** followed 为 null 表示全部关注 */
export const follows = (followed: string[] | null, topic: string) => followed === null || followed.includes(topic);

/**
 * 按关注的门类和当前选中的门类筛选新闻。
 * @returns visible 要显示的新闻；counts 每个已关注门类的条数（按 CATEGORIES 的顺序）；hidden 因为没关注而隐藏的条数
 */
export function filterStories(stories: Story[], followed: string[] | null, active: string | null) {
  const counts = new Map<string, number>();
  let hidden = 0;
  const kept: Story[] = [];
  for (const s of stories) {
    const c = categoryOf(s);
    if (!follows(followed, c)) {
      hidden++;
      continue;
    }
    kept.push(s);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const ordered = new Map(CATEGORIES.filter((c) => counts.has(c)).map((c) => [c as string, counts.get(c)!]));
  const visible = active && (CATEGORIES as readonly string[]).includes(active) ? kept.filter((s) => categoryOf(s) === active) : kept;
  return { visible, counts: ordered, hidden, total: kept.length };
}

/** 切换关注：至少保留一个；全部选上时存成 null（以后新增的门类也自动关注） */
export function toggleFollow(followed: string[] | null, topic: string): string[] | null {
  const current = followed ?? ALL_TOPICS;
  const next = current.includes(topic) ? current.filter((t) => t !== topic) : [...current, topic];
  if (next.length === 0) return current.length ? [...current] : null;
  return ALL_TOPICS.every((t) => next.includes(t)) ? null : ALL_TOPICS.filter((t) => next.includes(t));
}
