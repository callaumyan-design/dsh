import { describe, expect, it } from 'vitest';
import { ALL_TOPICS, categoryOf, filterStories, toggleFollow } from './topics';
import type { Story } from './types';

const s = (id: string, category: string | null): Story => ({ id, title: id, summary: null, category, importance: null, image: null, publishedAt: null, sources: [] });
const stories = [s('a', '数码'), s('b', 'AI'), s('c', '数码'), s('d', null), s('e', '旧的门类')];

describe('门类', () => {
  it('没有门类或未知门类算“其他”', () => {
    expect(categoryOf(s('x', null))).toBe('其他');
    expect(categoryOf(s('x', '旧的门类'))).toBe('其他');
  });

  it('全部关注：按门类计数，顺序固定', () => {
    const r = filterStories(stories, null, null);
    expect(r.visible.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect([...r.counts]).toEqual([['数码', 2], ['AI', 1], ['其他', 2]]);
    expect(r.hidden).toBe(0);
  });

  it('只看选中的门类', () => {
    expect(filterStories(stories, null, '数码').visible.map((x) => x.id)).toEqual(['a', 'c']);
    // 选中的是栏目（不是新闻门类）时，新闻列表不过滤，由页面决定怎么显示
    expect(filterStories(stories, null, '今日新品').visible.length).toBe(5);
  });

  it('没关注的门类被隐藏并计数', () => {
    const r = filterStories(stories, ['AI', '其他'], null);
    expect(r.visible.map((x) => x.id)).toEqual(['b', 'd', 'e']);
    expect(r.hidden).toBe(2);
    expect([...r.counts.keys()]).toEqual(['AI', '其他']);
  });

  it('切换关注：至少留一个，全选时存为 null', () => {
    const off = toggleFollow(null, '数码');
    expect(off).toEqual(ALL_TOPICS.filter((t) => t !== '数码'));
    expect(toggleFollow(off, '数码')).toBeNull();
    expect(toggleFollow(['AI'], 'AI')).toEqual(['AI']);
    expect(toggleFollow(['AI'], '数码')).toEqual(['数码', 'AI']);
  });
});
