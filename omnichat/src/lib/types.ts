import type { ModelInfo, ModelOutput, ProviderData } from '../../shared/types';

export type { ModelInfo, ModelOutput, ProviderData };

/** A configured AI provider (synced entity). */
export interface Provider extends ProviderData {
  id: string;
  /** Server timestamp of the last synced version. */
  syncedAt?: number;
}

export type ReasoningEffort = 'default' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ChatParams {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  /** How many previous messages to send. 0 / undefined = all. */
  contextCount?: number;
  reasoningEffort?: ReasoningEffort;
  stream?: boolean;
  /** Use the provider's native web search when it has one. */
  webSearch?: boolean;
  extraBody?: Record<string, unknown>;
  /** Options of image and video generation models. */
  media?: MediaParams;
}

/** Image / video generation options; each adapter maps them onto its API (unset: the API's default). */
export interface MediaParams {
  /** e.g. '1:1', '16:9', '9:16', '4:3', '3:4'. */
  aspect?: string;
  /** Images per request. */
  count?: number;
  quality?: 'low' | 'medium' | 'high';
  /** Video length in seconds. */
  seconds?: number;
  resolution?: '480p' | '720p' | '1080p';
  /** What to keep out of the picture (APIs that take a negative prompt). */
  negativePrompt?: string;
}

export interface Source {
  url: string;
  title?: string;
}

export interface Attachment {
  id: string;
  kind: 'image' | 'pdf' | 'text';
  name: string;
  mime: string;
  size: number;
  /** data: URL for images and PDFs. */
  dataUrl?: string;
  /** Decoded text for text-like files. */
  text?: string;
}

/** An image or video a model generated. */
export interface GeneratedMedia {
  id: string;
  kind: 'image' | 'video';
  mime: string;
  /** Stored by this server (/api/media/<id>), or a provider URL that was kept because it could not be downloaded (may expire). */
  url?: string;
  /** Inline copy, when the server has no media store (Cloudflare Workers). */
  dataUrl?: string;
  size?: number;
  /** The prompt as the model rewrote it (DALL·E 3 and others return it). */
  revisedPrompt?: string;
  /** Gemini's thought signature for the image, sent back with it when the chat continues. */
  signature?: string;
}

/** How far a long-running generation (mostly video) has got. */
export interface GenProgress {
  stage: 'queued' | 'running' | 'saving';
  /** 0-100 when the API reports it. */
  percent?: number;
}

export interface Usage {
  input?: number;
  output?: number;
  reasoning?: number;
  cached?: number;
}

export type MessageStatus = 'streaming' | 'done' | 'error' | 'aborted';

export interface MessageVersion {
  content: string;
  reasoning?: string;
  model?: string;
  providerId?: string;
  providerName?: string;
  usage?: Usage;
  status?: MessageStatus;
  error?: string;
  /** Known error shown in the user's language instead of `error` ('interrupted': the server restarted mid-reply). */
  errorCode?: 'interrupted';
  durationMs?: number;
  firstTokenMs?: number;
  reasoningMs?: number;
  finishReason?: string;
  /** Web pages the answer cited (provider-native search). */
  sources?: Source[];
  /** Transient while streaming: the query being searched. */
  searching?: string;
  /** Images and videos the model generated. */
  media?: GeneratedMedia[];
  /** Transient while generating media. */
  progress?: GenProgress;
  createdAt?: number;
}

export interface Message extends MessageVersion {
  id: string;
  createdAt: number;
  conversationId: string;
  role: 'user' | 'assistant';
  attachments?: Attachment[];
  /** All generated versions of an assistant reply (when regenerated). */
  versions?: MessageVersion[];
  versionIndex?: number;
  syncedAt?: number;
}

export interface Conversation {
  id: string;
  title: string;
  providerId?: string;
  model?: string;
  systemPrompt?: string;
  params?: ChatParams;
  pinned?: boolean;
  promptId?: string;
  /** The project this chat belongs to: its instructions and files are part of every request. */
  projectId?: string;
  createdAt: number;
  lastMessageAt?: number;
  titleGenerated?: boolean;
  syncedAt?: number;
}

export interface Prompt {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  systemPrompt: string;
  providerId?: string;
  model?: string;
  createdAt: number;
  order?: number;
  syncedAt?: number;
}

/** A workspace that groups chats and gives them shared instructions and reference files. */
export interface Project {
  id: string;
  name: string;
  /** An emoji shown in place of the folder icon. */
  icon?: string;
  description?: string;
  /** Added to the system prompt of every chat in the project. */
  instructions?: string;
  /** Knowledge files: text goes into the system prompt, images and PDFs are attached to the conversation. */
  files?: Attachment[];
  createdAt: number;
  syncedAt?: number;
}

export type ThemeMode = 'system' | 'light' | 'dark';
export type Language = 'auto' | 'zh' | 'en';

export interface Settings {
  theme: ThemeMode;
  accent: string;
  language: Language;
  fontSize: 'sm' | 'md' | 'lg';
  sendKey: 'enter' | 'mod-enter';
  defaultProviderId?: string;
  defaultModel?: string;
  titleProviderId?: string;
  titleModel?: string;
  autoTitle: boolean;
  defaultSystemPrompt?: string;
  defaultParams?: ChatParams;
  codeWrap: boolean;
  showUsage: boolean;
  renderMarkdownForUser: boolean;
  favoriteModels: string[];
  /** Shown instead of the login name (often an email address). Synced across devices. */
  nickname?: string;
  /** Transcription model for voice input; unset uses the browser's speech recognition. */
  voiceInput?: { providerId: string; model: string };
  syncedAt?: number;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  accent: 'indigo',
  language: 'auto',
  fontSize: 'md',
  sendKey: 'enter',
  autoTitle: true,
  codeWrap: false,
  showUsage: true,
  renderMarkdownForUser: false,
  favoriteModels: [],
};

export const modelKey = (providerId: string, model: string) => `${providerId}::${model}`;
