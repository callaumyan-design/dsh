import type { AuthStyle, ProviderData, ProviderType } from './types';

export function defaultAuthStyle(type: ProviderType): AuthStyle {
  switch (type) {
    case 'anthropic':
      return 'x-api-key';
    case 'gemini':
      return 'x-goog-api-key';
    default:
      return 'bearer';
  }
}

/** Attaches the provider's credential to outgoing request headers. */
export function applyAuth(headers: Headers, provider: Pick<ProviderData, 'type' | 'authStyle'>, key: string | null | undefined) {
  const style = provider.authStyle ?? defaultAuthStyle(provider.type);
  if (!key || style === 'none') return;
  switch (style) {
    case 'bearer':
      headers.set('authorization', `Bearer ${key}`);
      break;
    case 'x-api-key':
      headers.set('x-api-key', key);
      break;
    case 'api-key':
      headers.set('api-key', key);
      break;
    case 'x-goog-api-key':
      headers.set('x-goog-api-key', key);
      break;
  }
}

/** Joins a base URL (e.g. https://api.openai.com/v1) with an API path (e.g. /chat/completions). */
export function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, '') + (path.startsWith('/') ? path : `/${path}`);
}

export const ANTHROPIC_DEFAULT_VERSION = '2023-06-01';
