import { useEffect, useState } from 'react';
import { EditionView } from './components/Edition';
import { Archive, Me, Saved } from './components/Pages';
import { sync } from './lib/sync';
import { useStore } from './lib/store';

type Route = { name: 'today' } | { name: 'day'; date: string } | { name: 'archive' } | { name: 'saved' } | { name: 'me' };

function parse(hash: string): Route {
  const h = hash.replace(/^#/, '');
  const day = h.match(/^\/day\/(\d{4}-\d{2}-\d{2})$/);
  if (day) return { name: 'day', date: day[1] };
  if (h === '/archive') return { name: 'archive' };
  if (h === '/saved') return { name: 'saved' };
  if (h === '/me') return { name: 'me' };
  return { name: 'today' };
}

function useRoute() {
  const [route, setRoute] = useState(() => parse(location.hash));
  useEffect(() => {
    const on = () => {
      setRoute(parse(location.hash));
      window.scrollTo(0, 0);
    };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return route;
}

const TABS = [
  { href: '#/', label: '今天', match: ['today', 'day'] },
  { href: '#/archive', label: '往期', match: ['archive'] },
  { href: '#/saved', label: '收藏', match: ['saved'] },
  { href: '#/me', label: '我的', match: ['me'] },
];

export function App() {
  const route = useRoute();
  const savedCount = useStore((s) => s.bookmarks.length);

  useEffect(() => {
    void sync().catch(() => {});
    const onFocus = () => document.visibilityState === 'visible' && void sync().catch(() => {});
    document.addEventListener('visibilitychange', onFocus);
    return () => document.removeEventListener('visibilitychange', onFocus);
  }, []);

  // 打开收藏和我的页面时也同步一次，保证看到的是其他设备上的最新改动
  useEffect(() => {
    if (route.name === 'saved' || route.name === 'me') void sync().catch(() => {});
  }, [route.name]);

  return (
    <div className="shell">
      <header className="topbar">
        <a href="#/" className="brand">
          科技晨读
        </a>
        <nav className="tabs" aria-label="主导航">
          {TABS.map((t) => (
            <a key={t.href} href={t.href} className={`tab${t.match.includes(route.name) ? ' on' : ''}`} aria-current={t.match.includes(route.name) ? 'page' : undefined}>
              {t.label}
              {t.label === '收藏' && savedCount > 0 && <span className="count">{savedCount}</span>}
            </a>
          ))}
        </nav>
      </header>
      <main className="content">
        {route.name === 'today' && <EditionView date={null} />}
        {route.name === 'day' && <EditionView key={route.date} date={route.date} />}
        {route.name === 'archive' && <Archive />}
        {route.name === 'saved' && <Saved />}
        {route.name === 'me' && <Me />}
      </main>
    </div>
  );
}
