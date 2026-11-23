import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useStore } from '../lib/store';
import { sync } from '../lib/sync';
import type { Brief, Edition, Story } from '../lib/types';
import { formatDay, timeAgo } from '../lib/format';

const CATEGORY_CLASS: Record<string, string> = {
  数码: 'c-gadget',
  AI: 'c-ai',
  互联网: 'c-web',
  芯片与硬件: 'c-chip',
  开发者: 'c-dev',
  科学与前沿: 'c-sci',
  商业与政策: 'c-biz',
};

export function useEdition(date: string | null) {
  const [edition, setEdition] = useState<Edition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    (date ? api.edition(date) : api.latest())
      .then((e) => alive && setEdition(e))
      .catch((e: ApiError) => alive && setError(e.status === 404 ? (date ? `没有 ${date} 这一期` : '第一期还没出来，明天早上再来看看') : e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [date]);
  return { edition, error, loading };
}

export function EditionView({ date }: { date: string | null }) {
  const { edition, error, loading } = useEdition(date);
  const categories = useStore((s) => s.categories);
  const [filter, setFilter] = useState<string | null>(null);

  const present = useMemo(() => [...new Set((edition?.stories ?? []).map((s) => s.category).filter(Boolean))] as string[], [edition]);
  const stories = useMemo(() => {
    let list = edition?.stories ?? [];
    if (categories?.length) list = list.filter((s) => !s.category || categories.includes(s.category));
    if (filter) list = list.filter((s) => s.category === filter);
    return list;
  }, [edition, categories, filter]);

  if (loading && !edition) return <div className="state">正在加载…</div>;
  if (error && !edition) return <div className="state">{error}</div>;
  if (!edition) return null;

  return (
    <article className="edition">
      <header className="masthead">
        <p className="dateline">{formatDay(edition.date)}</p>
        <h1 className="headline">{edition.headline ?? '今日科技要闻'}</h1>
        <p className="tally">
          {edition.stories.length} 件大事 · {edition.products.length} 个新品 · {edition.github.length} 个热门仓库
        </p>
      </header>

      {present.length > 1 && (
        <nav className="chips" aria-label="按分类筛选">
          <button className={`chip${filter === null ? ' on' : ''}`} onClick={() => setFilter(null)} aria-pressed={filter === null}>
            全部
          </button>
          {present.map((c) => (
            <button key={c} className={`chip ${CATEGORY_CLASS[c] ?? ''}${filter === c ? ' on' : ''}`} onClick={() => setFilter(filter === c ? null : c)} aria-pressed={filter === c}>
              {c}
            </button>
          ))}
        </nav>
      )}

      <ol className="stories">
        {stories.map((s) => (
          <StoryCard key={s.id} story={s} date={edition.date} />
        ))}
      </ol>
      {!stories.length && <p className="state small">这个分类今天没有新闻。</p>}

      {edition.products.length > 0 && <BriefList title="今日新品" note="来自 Product Hunt" items={edition.products} />}
      {edition.github.length > 0 && <BriefList title="GitHub 热榜" note="今日新增 star 最多的仓库" items={edition.github} github />}

      <footer className="colophon">
        <p>
          生成于 {new Date(edition.generatedAt).toLocaleString('zh-CN', { hour12: false })}，共 {edition.sourceStatus.filter((s) => s.ok).length}/{edition.sourceStatus.length} 个来源可用。
        </p>
        {edition.ai ? (
          <p>标题与摘要由 AI（{edition.ai.model}）根据各媒体的报道生成，可能有疏漏，以原文为准。</p>
        ) : (
          <p>今天没有使用 AI，显示的是各媒体的原标题。</p>
        )}
      </footer>
    </article>
  );
}

function StoryCard({ story, date }: { story: Story; date: string }) {
  const [open, setOpen] = useState(false);
  const read = useStore((s) => s.read.includes(story.id));
  const saved = useStore((s) => s.bookmarks.some((b) => b.id === story.id));
  const toggleBookmark = useStore((s) => s.toggleBookmark);
  const markRead = useStore((s) => s.markRead);
  const [imgOk, setImgOk] = useState(true);
  const names = story.sources.map((s) => s.name);
  const lead = story.sources[0];

  const expand = () => {
    setOpen(!open);
    if (!read) {
      markRead(story.id);
      void sync().catch(() => {});
    }
  };

  return (
    <li className={`story${read ? ' read' : ''}`}>
      <div className="story-main">
        <div className="story-tags">
          {story.category && <span className={`tag ${CATEGORY_CLASS[story.category] ?? ''}`}>{story.category}</span>}
          {(story.importance ?? 0) >= 4 && <span className="tag hot">要闻</span>}
        </div>
        <h2 className="story-title">
          <button className="linklike" onClick={expand} aria-expanded={open}>
            {story.title}
          </button>
        </h2>
        {story.summary && <p className="story-summary">{story.summary}</p>}
        <p className="story-meta">
          {names.length > 2 ? `${names.slice(0, 2).join('、')} 等 ${names.length} 家报道` : names.join('、')}
          {story.publishedAt && <> · {timeAgo(story.publishedAt)}</>}
        </p>
        {open && (
          <ul className="sources">
            {story.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  <b>{s.name}</b>
                  <span lang={s.lang}>{s.title}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
        <div className="story-actions">
          {lead && (
            <a className="action" href={lead.url} target="_blank" rel="noopener noreferrer" onClick={() => markRead(story.id)}>
              读原文
            </a>
          )}
          <button
            className={`action${saved ? ' on' : ''}`}
            aria-pressed={saved}
            onClick={() => {
              toggleBookmark(story, date);
              void sync().catch(() => {});
            }}
          >
            {saved ? '已收藏' : '收藏'}
          </button>
        </div>
      </div>
      {story.image && imgOk && <img className="thumb" src={story.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setImgOk(false)} />}
    </li>
  );
}

function BriefList({ title, note, items, github = false }: { title: string; note: string; items: Brief[]; github?: boolean }) {
  return (
    <section className="briefs">
      <h2 className="section-title">
        {title}
        <small>{note}</small>
      </h2>
      <ol>
        {items.map((b, i) => (
          <li key={b.id}>
            <span className="brief-rank">{i + 1}</span>
            <div className="brief-body">
              <a href={b.url} target="_blank" rel="noopener noreferrer" className={`brief-name${github ? ' mono' : ''}`}>
                {b.name}
              </a>
              {b.tagline && <p className="brief-tagline">{b.tagline}</p>}
              {b.summary && <p className="brief-summary">{b.summary}</p>}
              {b.repo && (
                <p className="brief-meta">
                  {b.repo.language && <span>{b.repo.language}</span>}
                  {b.repo.starsToday != null && <span className="stars">+{b.repo.starsToday.toLocaleString('en-US')} 今日</span>}
                  {b.repo.stars != null && <span>★ {b.repo.stars.toLocaleString('en-US')}</span>}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
