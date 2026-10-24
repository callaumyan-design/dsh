import { useData } from '@/store/data';
import { zh } from './zh';
import { en } from './en';

export type Lang = 'zh' | 'en';
export type I18nKey = keyof typeof zh;

const dicts: Record<Lang, Record<string, string>> = { zh, en };

export function resolveLang(setting: string | undefined): Lang {
  if (setting === 'zh' || setting === 'en') return setting;
  const nav = typeof navigator !== 'undefined' ? navigator.language || '' : '';
  return nav.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function format(s: string, vars?: Record<string, string | number>) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`));
}

export function translate(lang: Lang, key: I18nKey, vars?: Record<string, string | number>) {
  return format(dicts[lang][key] ?? dicts.zh[key] ?? key, vars);
}

/** Non-React translation using the current settings. */
export function t(key: I18nKey, vars?: Record<string, string | number>) {
  return translate(resolveLang(useData.getState().settings.language), key, vars);
}

export function currentLang(): Lang {
  return resolveLang(useData.getState().settings.language);
}

export function useLang(): Lang {
  return resolveLang(useData((s) => s.settings.language));
}

export function useT() {
  const lang = useLang();
  return (key: I18nKey, vars?: Record<string, string | number>) => translate(lang, key, vars);
}
