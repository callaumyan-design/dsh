import { useEffect, useState } from 'react';
import { api, API_BASE } from '../lib/api';
import { useStore } from '../lib/store';
import { sync } from '../lib/sync';
import { loginWithPasskey, logout, passkeySupported, registerPasskey } from '../lib/passkey';
import { disablePush, enablePush, pushStatus, type PushStatus } from '../lib/push';
import type { EditionIndexEntry } from '../lib/types';
import { formatDay } from '../lib/format';

const CATEGORIES = ['数码', 'AI', '互联网', '芯片与硬件', '开发者', '科学与前沿', '商业与政策'];

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
          已登录：<b>{user.name}</b>。收藏、已读和分类设置会在登录了这个账号的设备之间同步。
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

function Categories() {
  const categories = useStore((s) => s.categories);
  const setCategories = useStore((s) => s.setCategories);
  const active = categories ?? CATEGORIES;
  const toggle = (c: string) => {
    const next = active.includes(c) ? active.filter((x) => x !== c) : [...active, c];
    setCategories(next.length === CATEGORIES.length || next.length === 0 ? null : next);
    void sync().catch(() => {});
  };
  return (
    <section className="panel">
      <h2>关注的分类</h2>
      <p>关掉的分类不会出现在“今天”里。</p>
      <div className="chips wrap">
        {CATEGORIES.map((c) => (
          <button key={c} className={`chip${active.includes(c) ? ' on' : ''}`} aria-pressed={active.includes(c)} onClick={() => toggle(c)}>
            {c}
          </button>
        ))}
      </div>
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
        <p>每天北京时间早上 7 点前，从 IT之家、36氪、少数派、爱范儿、极客公园、虎嗅、The Verge、TechCrunch、Ars Technica、Engadget、9to5Mac、GSMArena、MIT Technology Review、Product Hunt 和 GitHub 抓取过去一天的报道，由 AI 挑出大事、合并重复报道并写中文摘要。</p>
        {!API_BASE && <p className="msg error">这个版本没有配置服务器地址。</p>}
      </section>
    </section>
  );
}
