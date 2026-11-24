// Which build of the web app this page runs. Pages stay open for days (phones resume them instead of reloading), so
// after an update they would keep running old code; the server names its build on every API response, and a page
// that is behind reloads itself (see useAutoUpdate in App.tsx).
declare const __APP_BUILD__: string | undefined;

export const APP_BUILD = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : '';

let newer = false;
const listeners = new Set<() => void>();

/** Called with the build the server reports (the x-app-build header). */
export function noteServerBuild(build: string | null | undefined) {
  if (!APP_BUILD || !build || build === APP_BUILD || newer) return;
  newer = true;
  for (const l of listeners) l();
}

/** Runs `l` once a newer build is known to be deployed. */
export function onUpdateAvailable(l: () => void): () => void {
  listeners.add(l);
  if (newer) l();
  return () => listeners.delete(l);
}
