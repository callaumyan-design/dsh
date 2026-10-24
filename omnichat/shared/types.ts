// Types shared by the server and the web client.

export type EntityKind = 'conversation' | 'provider' | 'prompt' | 'settings';
export const ENTITY_KINDS: EntityKind[] = ['conversation', 'provider', 'prompt', 'settings'];

/** Wire protocol a provider speaks. Almost every vendor offers an OpenAI-compatible endpoint. */
export type ProviderType = 'openai' | 'anthropic' | 'gemini';

/** How the API key is attached to upstream requests. */
export type AuthStyle = 'bearer' | 'x-api-key' | 'api-key' | 'x-goog-api-key' | 'none';

/** proxy: the server attaches the key and forwards the call. direct: the browser calls the API itself. */
export type RequestMode = 'proxy' | 'direct';

export interface ModelInfo {
  id: string;
  name?: string;
  /** Hidden models stay configured but are not shown in pickers. */
  hidden?: boolean;
  vision?: boolean;
  reasoning?: boolean;
}

export interface ProviderData {
  name: string;
  type: ProviderType;
  presetId?: string;
  baseUrl: string;
  authStyle?: AuthStyle;
  mode?: RequestMode;
  enabled?: boolean;
  models: ModelInfo[];
  /** Extra headers sent with every request (e.g. OpenRouter's HTTP-Referer). */
  headers?: Record<string, string>;
  /** JSON merged into every chat request body; escape hatch for vendor-specific options. */
  extraBody?: Record<string, unknown>;
  /** Set by the server: whether a key is stored, and a masked preview. */
  hasKey?: boolean;
  keyHint?: string;
  /** Write-only: present only in pushes from the client. Never returned by the server. */
  apiKey?: string;
  order?: number;
  createdAt?: number;
}

export interface EntityRecord<T = unknown> {
  kind: EntityKind;
  id: string;
  data: T;
  updatedAt: number;
  deleted: boolean;
}

export interface MessageRecord<T = unknown> {
  id: string;
  conversationId: string;
  data: T;
  updatedAt: number;
  deleted: boolean;
}

export interface PushOp {
  kind: EntityKind | 'message';
  id: string;
  data?: unknown;
  deleted?: boolean;
}

export interface PublicUser {
  id: string;
  username: string;
  isAdmin: boolean;
  createdAt: number;
}

export interface AuthStatus {
  hasUsers: boolean;
  allowRegister: boolean;
  version: string;
}

export const APP_VERSION = '1.0.0';
