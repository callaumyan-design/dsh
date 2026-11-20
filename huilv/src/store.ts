import { create } from 'zustand';
import { press, toPlain, evaluate, type Key } from './lib/calc';
import { CURRENCY_MAP, DEFAULT_LIST } from './lib/currencies';
import { convert, fetchRates, isRateData, type RateData } from './lib/rates';
import type { Decimals } from './lib/format';
import snapshot from './data/snapshot.json';

export type Theme = 'system' | 'light' | 'dark';
export type Status = 'idle' | 'loading' | 'error';

const KEY = 'huilv:v1';
const RATES_KEY = 'huilv:rates';
/** 超过这个时间就在后台重新获取汇率 */
export const REFRESH_AFTER = 60 * 60 * 1000;

export const BUNDLED: RateData = { ...(snapshot as Omit<RateData, 'fetchedAt'>), fetchedAt: 0 };

interface Prefs {
  list: string[];
  active: string;
  expr: string;
  decimals: Decimals;
  theme: Theme;
}

const DEFAULT_PREFS: Prefs = { list: DEFAULT_LIST, active: 'CNY', expr: '100', decimals: 'auto', theme: 'system' };

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 隐私模式等情况下存不了，不影响使用 */
  }
}

function loadPrefs(): Prefs {
  const p = read<Partial<Prefs>>(KEY) ?? {};
  const list = Array.isArray(p.list) ? p.list.filter((c) => typeof c === 'string' && CURRENCY_MAP[c]) : DEFAULT_PREFS.list;
  const uniq = [...new Set(list)];
  const finalList = uniq.length ? uniq : DEFAULT_PREFS.list;
  const active = typeof p.active === 'string' && finalList.includes(p.active) ? p.active : finalList[0];
  const decimals: Decimals = p.decimals === 0 || p.decimals === 2 || p.decimals === 4 || p.decimals === 'auto' ? p.decimals : 'auto';
  const theme: Theme = p.theme === 'light' || p.theme === 'dark' || p.theme === 'system' ? p.theme : 'system';
  const expr = typeof p.expr === 'string' && /^-?[0-9.+\-*/]{0,40}$/.test(p.expr) ? p.expr : DEFAULT_PREFS.expr;
  return { list: finalList, active, expr, decimals, theme };
}

function loadRates(): RateData {
  const cached = read<RateData>(RATES_KEY);
  // 缓存比内置数据还旧时（比如很久没打开，应用又更新过），用内置的
  if (isRateData(cached) && cached.date >= BUNDLED.date) return cached;
  return BUNDLED;
}

export interface State extends Prefs {
  fresh: boolean;
  rates: RateData;
  status: Status;
  editing: boolean;
  toast: { id: number; text: string } | null;
  /** 当前输入的数值（算式的结果） */
  amount: () => number;
  key: (k: Key) => void;
  setActive: (code: string) => void;
  moveActive: (delta: number) => void;
  add: (code: string) => void;
  remove: (code: string) => void;
  toggle: (code: string) => void;
  /** 把列表里的 old 换成 next；next 已经在列表里时两者交换位置 */
  replace: (old: string, next: string) => void;
  reorder: (list: string[]) => void;
  setDecimals: (d: Decimals) => void;
  setTheme: (t: Theme) => void;
  setEditing: (v: boolean) => void;
  refresh: (opts?: { force?: boolean }) => Promise<void>;
  showToast: (text: string) => void;
  reset: () => void;
}

const prefs = loadPrefs();

export const useStore = create<State>((set, get) => ({
  ...prefs,
  fresh: true,
  rates: loadRates(),
  status: 'idle',
  editing: false,
  toast: null,

  amount: () => evaluate(get().expr) ?? NaN,

  key: (k) => {
    const s = get();
    const next = press({ expr: s.expr, fresh: s.fresh }, k);
    set(next);
  },

  setActive: (code) => {
    const s = get();
    if (code === s.active) {
      set({ fresh: true });
      return;
    }
    // 切换基准货币时，把当前换算出的金额带过去（按显示精度取整，和屏幕上看到的一致）
    const v = convert(s.amount(), s.active, code, s.rates.rates);
    let expr = '';
    if (Number.isFinite(v) && v !== 0) {
      const abs = Math.abs(v);
      const digits = s.decimals !== 'auto' ? s.decimals : abs >= 1 ? 2 : Math.min(12, 3 - Math.floor(Math.log10(abs)));
      expr = toPlain(Number(v.toFixed(digits)));
    } else if (v === 0) expr = '0';
    set({ active: code, expr, fresh: true });
  },

  moveActive: (delta) => {
    const { list, active } = get();
    const i = list.indexOf(active);
    const next = list[(i + delta + list.length) % list.length];
    if (next) get().setActive(next);
  },

  add: (code) => {
    const { list } = get();
    if (!CURRENCY_MAP[code] || list.includes(code)) return;
    set({ list: [...list, code] });
  },

  remove: (code) => {
    const { list, active } = get();
    if (list.length <= 1) return;
    const next = list.filter((c) => c !== code);
    if (code === active) {
      const i = list.indexOf(code);
      get().setActive(next[Math.min(i, next.length - 1)]);
    }
    set({ list: next });
  },

  toggle: (code) => {
    const { list } = get();
    if (list.includes(code)) get().remove(code);
    else get().add(code);
  },

  replace: (old, next) => {
    const { list, active } = get();
    const i = list.indexOf(old);
    if (i < 0 || old === next || !CURRENCY_MAP[next]) return;
    const j = list.indexOf(next);
    const nl = [...list];
    nl[i] = next;
    if (j >= 0) nl[j] = old;
    // 换掉的是当前输入的货币：金额换算到新货币
    if (active === old) get().setActive(next);
    set({ list: nl });
    get().showToast(j >= 0 ? `已交换 ${old} 和 ${next} 的位置` : `已将 ${old} 换成 ${next}`);
  },

  reorder: (list) => set({ list }),
  setDecimals: (decimals) => set({ decimals }),
  setTheme: (theme) => set({ theme }),
  setEditing: (editing) => set({ editing }),

  refresh: async ({ force = false } = {}) => {
    const s = get();
    if (s.status === 'loading') return;
    if (!force && s.rates.fetchedAt && Date.now() - s.rates.fetchedAt < REFRESH_AFTER) return;
    set({ status: 'loading' });
    try {
      const http = typeof location !== 'undefined' && /^https?:$/.test(location.protocol);
      const data = await fetchRates({ apiUrl: http ? new URL('api/rates', location.href).href : null });
      write(RATES_KEY, data);
      set({ rates: data, status: 'idle' });
      if (force) get().showToast(`已更新到 ${data.date} 的汇率`);
    } catch {
      set({ status: 'error' });
      if (force) get().showToast('网络不可用，继续使用已保存的汇率');
    }
  },

  showToast: (text) => set({ toast: { id: Date.now(), text } }),

  reset: () => {
    set({ ...DEFAULT_PREFS, fresh: true, editing: false });
    get().showToast('已恢复默认设置');
  },
}));

// 偏好设置变化时保存
useStore.subscribe((s, prev) => {
  if (s.list !== prev.list || s.active !== prev.active || s.expr !== prev.expr || s.decimals !== prev.decimals || s.theme !== prev.theme) {
    const { list, active, expr, decimals, theme } = s;
    write(KEY, { list, active, expr, decimals, theme });
  }
});
