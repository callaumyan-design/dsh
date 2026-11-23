import { useEffect, useState } from 'react';
import { api, API_BASE } from '../lib/api';
import { useStore } from '../lib/store';
import { sync } from '../lib/sync';
import { loginWithPasskey, logout, passkeySupported, registerPasskey } from '../lib/passkey';
import { disablePush, enablePush, pushStatus, type PushStatus } from '../lib/push';
import type { EditionIndexEntry } from '../lib/types';
import { formatDay } from '../lib/format';
import { ALL_TOPICS, CATEGORIES, SECTIONS, TOPIC_CLASS, follows, toggleFollow } from '../lib/topics';


export function Archive() {
  const [list, setList] = useState<EditionIndexEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.editions().then(setList).catch((e) => setError(e.message));
  }, []);
  if (error) return <div className="state">{error}</div>;
  if (!list) return <div className="state">正在加载…</div>;
  if (!list.length) return <div className="state">还没有往期。</div>;
  return (
    <section className="page">
      <h1 className="page-title">往期</h1>
      <ol className="archive">
        {list.map((e) => (
          <li key={e.date}>
            <a href={`#/day/${e.date}`}>
              <span className="archive-date">{formatDay(e.date)}</span>
              <span className="archive-headline">{e.headline ?? `${e.storyCount} 条新闻`}</span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Saved() {
  const bookmarks = useStore((s) => s.bookmarks);
  const remove = useStore((s) => s.removeBookmark);
  const token = useStore((s) => s.token);
  return (
    <section className="page">
      <h1 className="page-title">收藏</h1>
      {!token && bookmarks.length > 0 && <p className="hint">收藏只保存在这台设备上。登录后可以在手机和电脑之间同步。</p>}
      {!bookmarks.length ? (
        <div className="state small">还没有收藏。在新闻下面点“收藏”就会出现在这里。</div>
      ) : (
        <ol className="saved">
          {bookmarks.map((b) => (
            <li key={b.id}>
              <a href={b.url} target="_blank" rel="noopener noreferrer" className="saved-title">
                {b.title}
              </a>
              {b.summary && <p className="story-summary">{b.summary}</p>}
              <p className="story-meta">
                {[b.category, b.source, b.date && formatDay(b.date)].filter(Boolean).join(' · ')}
              </p>
              <button
                className="action"
                onClick={() => {
                  remove(b.id);
                  void sync().catch(() => {});
                }}
              >
                取消收藏
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function useAsyncAction() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const run = async (fn: () => Promise<void>, ok?: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      if (ok) setMessage({ kind: 'ok', text: ok });
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return { busy, message, run };
}

function Account() {
  const user = useStore((s) => s.user);
  const [name, setName] = useState('');
  const { busy, message, run } = useAsyncAction();
  const supported = passkeySupported();

  if (user) {
    return (
      <section className="panel">
        <h2>账号</h2>
        <p>
          已登录：<b>{user.name}</b>。收藏、已读和关注的门类会在登录了这个账号的设备之间同步。
        </p>
        <div className="row">
          <button className="btn" disabled={busy} onClick={() => run(() => registerPasskey(user.name), '已在这台设备上添加通行密钥')}>
            在这台设备上添加通行密钥
          </button>
          <button className="btn quiet" disabled={busy} onClick={() => run(logout)}>
            退出登录
          </button>
        </div>
        {message && <p className={`msg ${message.kind}`} role="status">{message.text}</p>}
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>账号</h2>
      <p>用通行密钥登录：在手机或电脑上用面容、指纹或设备密码验证，不需要设置密码。登录后收藏和已读会在设备之间同步。</p>
      {!supported && <p className="msg error">这个浏览器不支持通行密钥。</p>}
      <div className="row">
        <button className="btn primary" disabled={busy || !supported} onClick={() => run(loginWithPasskey)}>
          用通行密钥登录
        </button>
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => registerPasskey(name.trim() || '读者'));
        }}
      >
        <label htmlFor="new-name" className="sr-only">
          昵称
        </label>
        <input id="new-name" className="input" placeholder="昵称（可不填）" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn" disabled={busy || !supported} type="submit">
          新建账号
        </button>
      </form>
      {message && <p className={`msg ${message.kind}`} role="status">{message.text}</p>}
    </section>
  );
}

function Push() {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const { busy, message, run } = useAsyncAction();
  const refresh = () => pushStatus().then(setStatus);
  useEffect(() => {
    void refresh();
  }, []);

  const text: Record<PushStatus, string> = {
    unsupported: '这个浏览器不支持推送通知。',
    'needs-install': '在 iPhone 和 iPad 上，需要先用 Safari 的“分享 → 添加到主屏幕”安装，再从主屏幕打开，才能开启通知。',
    denied: '通知权限被关掉了，需要在浏览器或系统设置里重新允许。',
    off: '每天早上新一期出来时提醒你。',
    on: '已开启。每天早上新一期出来时会收到通知。',
  };
  return (
    <section className="panel">
      <h2>每日提醒</h2>
      <p>{status ? text[status] : '正在检查…'}</p>
      {(status === 'off' || status === 'on') && (
        <div className="row">
          <button
            className={`btn${status === 'off' ? ' primary' : ' quiet'}`}
            disabled={busy}
            onClick={() => run(async () => {
              await (status === 'off' ? enablePush() : disablePush());
              await refresh();
            })}
          >
            {status === 'off' ? '开启通知' : '关闭通知'}
          </button>
        </div>
      )}
      {message && <p className={`msg ${message.kind}`} role="status">{message.text}</p>}
    </section>
  );
}

const TOPIC_HINT: Record<string, string> = {
  数码: '手机、电脑、平板、耳机、相机、游戏机',
  AI: '大模型、AI 产品与公司',
  互联网: '平台与应用、社交、电商、网络安全',
  芯片与硬件: '芯片、半导体、数据中心',
  开发者: '开源、编程语言、开发工具',
  科学与前沿: '航天、量子、生物医学、机器人',
  商业与政策: '融资并购、财报、监管与诉讼',
  其他: '归不进以上门类的新闻',
  今日新品: 'Product Hunt 当天的新产品',
  'GitHub 热榜': '当天新增 star 最多的仓库',
};

function Categories() {
  const followed = useStore((s) => s.categories);
  const setCategories = useStore((s) => s.setCategories);
  const count = followed?.length ?? ALL_TOPICS.length;
  const set = (next: string[] | null) => {
    setCategories(next);
    void sync().catch(() => {});
  };
  const group = (title: string, topics: readonly string[]) => (
    <div className="topic-group">
      <h3>{title}</h3>
      <ul className="topics">
        {topics.map((t) => {
          const on = follows(followed, t);
          const last = on && count === 1;
          return (
            <li key={t}>
              <label className={`topic ${TOPIC_CLASS[t] ?? ''}${on ? ' on' : ''}`}>
                <input type="checkbox" checked={on} disabled={last} onChange={() => set(toggleFollow(followed, t))} />
                <span className="topic-name">{t}</span>
                <span className="topic-hint">{TOPIC_HINT[t]}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
  return (
    <section className="panel" id="topics">
      <h2>关注的门类</h2>
      <p>只看勾选的门类。没勾选的不会出现在“今天”和往期里；至少要留一个。{followed === null ? '现在是全部关注。' : `已关注 ${count} 个。`}</p>
      {group('新闻', CATEGORIES)}
      {group('栏目', SECTIONS)}
      {followed !== null && (
        <div className="row">
          <button className="btn quiet" onClick={() => set(null)}>
            全部关注
          </button>
        </div>
      )}
    </section>
  );
}

export function Me() {
  return (
    <section className="page">
      <h1 className="page-title">我的</h1>
      <Account />
      <Push />
      <Categories />
      <section className="panel about">
        <h2>关于</h2>
        <p>每天北京时间早上 7 点前，从 IT之家、36氪、少数派、爱范儿、极客公园、钛媒体、虎嗅、The Verge、TechCrunch、Ars Technica、Engadget、9to5Mac、GSMArena、MIT Technology Review、Product Hunt 和 GitHub 抓取过去一天的报道，由 AI 挑出大事、合并重复报道并写中文摘要。</p>
        {!API_BASE && <p className="msg error">这个版本没有配置服务器地址。</p>}
      </section>
    </section>
  );
}
