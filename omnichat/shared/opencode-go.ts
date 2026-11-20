// OpenCode Go (https://opencode.ai/docs/go/): a subscription gateway whose models sit behind different wire protocols
// on one host, and which rejects requests that lack an x-opencode-session header. Shared by the client and the proxy.
import type { AuthStyle, ProviderData } from './types';

export const OPENCODE_GO_ROOT = 'https://opencode.ai/inference/go';
export const OPENCODE_GO_USER_AGENT = 'CatGPT/1.0';

export type GoProtocol = 'chat' | 'responses' | 'anthropic' | 'gemini';

/** Path prefix (under the gateway root) of each protocol. */
export const GO_PREFIX: Record<GoProtocol, string> = {
  chat: '/openai/v1',
  responses: '/openai/v1',
  anthropic: '/anthropic/v1',
  gemini: '/google/v1beta',
};

export interface GoModel {
  name: string;
  protocol: GoProtocol;
  vision?: boolean;
  pdf?: boolean;
}

/** Known models (from the Go docs and models.dev). Unknown ids fall back to goProtocol()'s name rules. */
export const OPENCODE_GO_MODELS: Record<string, GoModel> = {
  'kimi-k3.1-pro': { name: 'Kimi K3.1 Pro', protocol: 'chat', vision: true },
  'kimi-k3': { name: 'Kimi K3', protocol: 'chat', vision: true },
  'kimi-k2.7-code': { name: 'Kimi K2.7 Code', protocol: 'chat', vision: true },
  'glm-5.3': { name: 'GLM-5.3', protocol: 'chat' },
  'glm-5.3-flash': { name: 'GLM-5.3-Flash', protocol: 'chat', vision: true },
  'glm-5.2': { name: 'GLM-5.2', protocol: 'chat' },
  'deepseek-v4-pro': { name: 'DeepSeek V4 Pro', protocol: 'chat' },
  'deepseek-v4.1-flash': { name: 'DeepSeek V4.1 Flash', protocol: 'chat', vision: true },
  'qwen3.8-max': { name: 'Qwen3.8 Max', protocol: 'anthropic', vision: true },
  'qwen3.8-flash': { name: 'Qwen3.8 Flash', protocol: 'anthropic', vision: true },
  'qwen3.7-plus': { name: 'Qwen3.7 Plus', protocol: 'anthropic', vision: true },
  'minimax-m3': { name: 'MiniMax M3', protocol: 'anthropic', vision: true },
  'minimax-m3.1-flash': { name: 'MiniMax M3.1 Flash', protocol: 'chat', vision: true },
  'mimo-v2.6-pro': { name: 'MiMo-V2.6-Pro', protocol: 'chat', vision: true },
  'mimo-v2.6-flash': { name: 'MiMo-V2.6-Flash', protocol: 'chat', vision: true },
  'mimo-v2.5-pro': { name: 'MiMo-V2.5-Pro', protocol: 'chat' },
  'mimo-v2.5': { name: 'MiMo-V2.5', protocol: 'chat', vision: true },
  'longcat-2.0': { name: 'LongCat-2.0', protocol: 'chat' },
  'step-5-preview': { name: 'Step 5 Preview', protocol: 'chat', vision: true },
  'hy4-preview': { name: 'Hy4 preview', protocol: 'chat' },
  hy3: { name: 'Hy3', protocol: 'chat' },
  'beam-free': { name: 'Beam Free', protocol: 'chat' },
  'grok-4.7': { name: 'Grok 4.7', protocol: 'responses', vision: true, pdf: true },
  'gpt-6-luna': { name: 'GPT 6 Luna', protocol: 'responses', vision: true, pdf: true },
  'gpt-5.6-luna': { name: 'GPT 5.6 Luna', protocol: 'responses', vision: true, pdf: true },
  'muse-spark-1.3-contributor': { name: 'Muse Spark 1.3 Contributor', protocol: 'responses', vision: true, pdf: true },
  'muse-spark-1.2-contributor': { name: 'Muse Spark 1.2 Contributor', protocol: 'responses', vision: true, pdf: true },
  'claude-haiku-5-5': { name: 'Claude Haiku 5.5', protocol: 'anthropic', vision: true, pdf: true },
  'gemini-4-argon': { name: 'Gemini 4 Argon', protocol: 'gemini', vision: true, pdf: true },
};

/** Default model list of a new OpenCode Go provider. */
export const OPENCODE_GO_DEFAULT_MODELS = Object.keys(OPENCODE_GO_MODELS);

export function goProtocol(model: string): GoProtocol {
  const id = model.toLowerCase().replace(/^opencode-go\//, '');
  const known = OPENCODE_GO_MODELS[id];
  if (known) return known.protocol;
  // Qwen 3.6+, MiniMax M2.5+ (except the Flash models) and Claude are served over the Messages API.
  if (/^claude-|^qwen3\.([6-9]|\d\d)|^minimax-m[\d.]+$/.test(id)) return 'anthropic';
  if (/^gemini-/.test(id)) return 'gemini';
  if (/^(gpt-|grok-|muse-spark|o\d)/.test(id)) return 'responses';
  return 'chat';
}

/** Whether a provider talks to OpenCode Go: the preset, or a generic provider pointed at its host. */
export function isOpencodeGo(p: Pick<ProviderData, 'presetId' | 'baseUrl'>): boolean {
  return p.presetId === 'opencode-go' || /^https?:\/\/(www\.)?opencode\.ai\/(inference|zen)\/go(\/|$)/i.test(p.baseUrl ?? '');
}

/** Gateway root that protocol prefixes are appended to. Any opencode.ai Go URL maps to the current root. */
export function opencodeGoRoot(baseUrl: string): string {
  if (!baseUrl || /^https?:\/\/(www\.)?opencode\.ai\//i.test(baseUrl)) return OPENCODE_GO_ROOT;
  return baseUrl.replace(/\/+$/, '');
}

/** Each protocol's native credential header, chosen from the request path. */
export function opencodeGoAuthStyle(path: string): AuthStyle {
  if (path.startsWith(GO_PREFIX.anthropic)) return 'x-api-key';
  if (path.startsWith(GO_PREFIX.gemini)) return 'x-goog-api-key';
  return 'bearer';
}
