import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useStore } from '../lib/store';
import { sync } from '../lib/sync';
import type { Brief, Edition, Story } from '../lib/types';
import { formatDay, timeAgo } from '../lib/format';
import { CATEGORIES, categoryOf, filterStories, follows, SECTIONS, TOPIC_CLASS } from '../lib/topics';

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
  const followed = useStore((st) => st.categories);
  const [active, setActive] = useState<string | null>(null);

  const { visible, counts, hidden, total } = useMemo(() => filterStories(edition?.stories ?? [], followed, active), [edition, followed, active]);

  if (loading && !edition) return <div className="state">正在加载…</div>;
  if (error && !edition) return <div className="state">{error}</div>;
  if (!edition) return null;

  const showProducts = edition.products.length > 0 && follows(followed, '今日新品');
  const showGithub = edition.github.length > 0 && follows(followed, 'GitHub 热榜');
  const isSection = (SECTIONS as readonly string[]).includes(active ?? '');
  const showStories = !isSection;
  const sectionChips = [showProducts && ['今日新品', edition.products.length], showGithub && ['GitHub 热榜', edition.github.length]].filter(Boolean) as [string, number][];

  return (
    <article className="edition">
      <header className="masthead">
        <p className="dateline">{formatDay(edition.date)}</p>
        <h1 className="headline">{edition.headline ?? '今日科技要闻'}</h1>
        <p className="tally">
          {edition.stories.length} 条新闻 · {edition.products.length} 个新品 · {edition.github.length} 个热门仓库
        </p>
      </header>

      <nav className="chips" aria-label="按门类筛选">
        <button className={`chip${active === null ? ' on' : ''}`} onClick={() => setActive(null)} aria-pressed={active === null}>
          全部<span className="n">{total}</span>
        </button>
        {/* 关注的门类全部列出来；当天没有新闻的显示 0、不能点，这样一眼能看到所有门类 */}
        {CATEGORIES.filter((c) => follows(followed, c)).map((c) => {
          const n = counts.get(c) ?? 0;
          return (
            <button
              key={c}
              className={`chip ${TOPIC_CLASS[c] ?? ''}${active === c ? ' on' : ''}${n ? '' : ' empty'}`}
              onClick={() => setActive(active === c ? null : c)}
              aria-pressed={active === c}
              disabled={!n}
              title={n ? undefined : '今天这个门类没有新闻'}
            >
              {c}
              <span className="n">{n}</span>
            </button>
          );
        })}
        {sectionChips.map(([c, n]) => (
          <button key={c} className={`chip section${active === c ? ' on' : ''}`} onClick={() => setActive(active === c ? null : c)} aria-pressed={active === c}>
            {c}
            <span className="n">{n}</span>
          </button>
        ))}
      </nav>

      {showStories && (
        <ol className="stories">
          {visible.map((s) => (
            <StoryCard key={s.id} story={s} date={edition.date} />
          ))}
        </ol>
      )}
      {showStories && !visible.length && (
        <p className="state small">{total ? '这个门类今天没有新闻。' : '你关注的门类今天没有新闻。'}</p>
      )}

      {showProducts && (active === null || active === '今日新品') && <BriefList title="今日新品" note="来自 Product Hunt" items={edition.products} />}
      {showGithub && (active === null || active === 'GitHub 热榜') && <BriefList title="GitHub 热榜" note="今日新增 star 最多的仓库" items={edition.github} github />}

      {hidden > 0 && (
        <p className="hidden-note">
          还有 {hidden} 条新闻属于你没关注的门类，没有显示。<a href="#/me">管理关注的门类</a>
        </p>
      )}

      <footer className="colophon">
        <p>
          生成于 {new Date(edition.generatedAt).toLocaleString('zh-CN', { hour12: false })}，共 {edition.sourceStatus.filter((s) => s.ok).length}/{edition.sourceStatus.length} 个来源可用。
        </p>
        {edition.ai ? (
          <p>标题、摘要和门类由 AI（{edition.ai.model}）根据各媒体的报道生成，可能有疏漏，以原文为准。</p>
        ) : (
          <p>今天没有使用 AI：显示的是各媒体的原标题，门类按关键词自动归类。</p>
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
          <span className={`tag ${TOPIC_CLASS[categoryOf(story)] ?? ''}`}>{categoryOf(story)}</span>
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
