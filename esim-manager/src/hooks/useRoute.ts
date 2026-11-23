import { useEffect, useState } from 'react';

export const ROUTES = ['dashboard', 'profiles', 'install', 'settings', 'diagnostics'] as const;
export type Route = (typeof ROUTES)[number];

function parse(): Route {
  const h = window.location.hash.replace(/^#\/?/, '');
  return (ROUTES as readonly string[]).includes(h) ? (h as Route) : 'dashboard';
}

/** 基于 hash 的极简路由（静态部署无需服务端配置）。 */
export function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const navigate = (r: Route) => {
    if (r !== route) window.location.hash = `/${r}`;
    window.scrollTo({ top: 0 });
  };
  return [route, navigate];
}
