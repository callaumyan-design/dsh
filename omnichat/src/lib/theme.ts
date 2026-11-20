export const ACCENTS: Record<string, { light: string; dark: string; fgLight?: string; fgDark?: string }> = {
  indigo: { light: '#5b5bd6', dark: '#7474ee' },
  violet: { light: '#7c3aed', dark: '#8b5cf6' },
  blue: { light: '#2563eb', dark: '#3b82f6' },
  teal: { light: '#0f766e', dark: '#14b8a6', fgDark: '#04201d' },
  green: { light: '#15803d', dark: '#22c55e', fgDark: '#052e16' },
  orange: { light: '#c2410c', dark: '#f97316', fgDark: '#1c0a02' },
  rose: { light: '#e11d48', dark: '#f43f5e' },
  neutral: { light: '#18181b', dark: '#e4e4e7', fgDark: '#18181b' },
};

const THEME_CACHE = 'omnichat.theme';

function mix(hex: string, amount: number, target: string) {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const a = p(hex);
  const b = p(target);
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * amount).toString(16).padStart(2, '0')).join('')}`;
}

export function applyTheme(theme: 'system' | 'light' | 'dark', accent: string, fontSize: string) {
  const root = document.documentElement;
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.classList.toggle('dark', dark);
  const a = ACCENTS[accent] ?? ACCENTS.indigo;
  const color = dark ? a.dark : a.light;
  root.style.setProperty('--accent', color);
  root.style.setProperty('--accent-hover', mix(color, 0.12, dark ? '#ffffff' : '#000000'));
  root.style.setProperty('--accent-fg', (dark ? a.fgDark : a.fgLight) ?? '#ffffff');
  root.dataset.font = fontSize;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#161618' : '#ffffff');
  try {
    localStorage.setItem(THEME_CACHE, JSON.stringify({ theme, accent, fontSize }));
  } catch {
    /* ignore */
  }
}

export function cachedTheme(): { theme: 'system' | 'light' | 'dark'; accent: string; fontSize: string } {
  try {
    const v = JSON.parse(localStorage.getItem(THEME_CACHE) ?? 'null');
    if (v) return v;
  } catch {
    /* ignore */
  }
  return { theme: 'system', accent: 'indigo', fontSize: 'md' };
}
