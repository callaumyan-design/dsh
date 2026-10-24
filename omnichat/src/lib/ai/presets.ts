import type { AuthStyle, ProviderType, RequestMode } from '../../../shared/types';

export type ReasoningStyle = 'openai' | 'openrouter' | 'enable_thinking' | 'thinking_type' | 'none';

export interface Quirks {
  /** Send stream_options.include_usage to receive token usage while streaming. */
  streamUsage?: boolean;
  maxTokensField?: 'max_tokens' | 'max_completion_tokens';
  /** How the "reasoning effort" setting maps onto the request body. */
  reasoning?: ReasoningStyle;
  /** Accepts PDF files as `file` content parts (OpenAI official). */
  pdf?: boolean;
}

export interface ProviderPreset {
  id: string;
  name: string;
  /** Localized name for Chinese UI. */
  nameZh?: string;
  type: ProviderType;
  baseUrl: string;
  authStyle?: AuthStyle;
  mode?: RequestMode;
  models: string[];
  keyUrl?: string;
  color: string;
  region: 'global' | 'cn' | 'local' | 'custom';
  quirks?: Quirks;
  headers?: Record<string, string>;
  noKey?: boolean;
}

export const PRESETS: ProviderPreset[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-5.1', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-4.1', 'gpt-4o', 'o3', 'o4-mini'],
    keyUrl: 'https://platform.openai.com/api-keys',
    color: '#10a37f',
    region: 'global',
    quirks: { maxTokensField: 'max_completion_tokens', reasoning: 'openai', pdf: true },
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    type: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1', 'claude-opus-4-8'],
    keyUrl: 'https://console.anthropic.com/settings/keys',
    color: '#d97757',
    region: 'global',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    type: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: ['gemini-3-pro-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
    keyUrl: 'https://aistudio.google.com/apikey',
    color: '#4285f4',
    region: 'global',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    nameZh: 'DeepSeek 深度求索',
    type: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    keyUrl: 'https://platform.deepseek.com/api_keys',
    color: '#4d6bfe',
    region: 'cn',
    quirks: { reasoning: 'none' },
  },
  {
    id: 'qwen',
    name: 'Alibaba Qwen (DashScope)',
    nameZh: '阿里云百炼 · 通义千问',
    type: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen3-max', 'qwen-plus', 'qwen-flash', 'qwen-turbo', 'qwen-vl-max', 'qwq-plus'],
    keyUrl: 'https://bailian.console.aliyun.com/?apiKey=1',
    color: '#615ced',
    region: 'cn',
    quirks: { reasoning: 'enable_thinking' },
  },
  {
    id: 'moonshot',
    name: 'Moonshot Kimi',
    nameZh: '月之暗面 Kimi',
    type: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['kimi-k2-turbo-preview', 'kimi-k2-thinking', 'kimi-latest', 'moonshot-v1-32k'],
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    color: '#1f2937',
    region: 'cn',
    quirks: { reasoning: 'none' },
  },
  {
    id: 'zhipu',
    name: 'Zhipu GLM',
    nameZh: '智谱 GLM',
    type: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4.6', 'glm-4.5-air', 'glm-4.5v', 'glm-4-flash'],
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    color: '#3859ff',
    region: 'cn',
    quirks: { reasoning: 'thinking_type' },
  },
  {
    id: 'doubao',
    name: 'Volcengine Ark (Doubao)',
    nameZh: '火山方舟 · 豆包',
    type: 'openai',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    models: ['doubao-seed-1-6-250615', 'doubao-seed-1-6-flash-250615'],
    keyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
    color: '#2563eb',
    region: 'cn',
    quirks: { reasoning: 'thinking_type' },
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow',
    nameZh: '硅基流动 SiliconFlow',
    type: 'openai',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: ['deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1', 'Qwen/Qwen3-235B-A22B-Instruct-2507', 'moonshotai/Kimi-K2-Instruct'],
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    color: '#7c3aed',
    region: 'cn',
    quirks: { reasoning: 'enable_thinking' },
  },
  {
    id: 'baidu',
    name: 'Baidu Qianfan (ERNIE)',
    nameZh: '百度千帆 · 文心',
    type: 'openai',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    models: ['ernie-4.5-turbo-128k', 'ernie-x1-turbo-32k', 'ernie-speed-128k'],
    keyUrl: 'https://console.bce.baidu.com/iam/#/iam/apikey/list',
    color: '#2932e1',
    region: 'cn',
    quirks: { reasoning: 'none' },
  },
  {
    id: 'hunyuan',
    name: 'Tencent Hunyuan',
    nameZh: '腾讯混元',
    type: 'openai',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    models: ['hunyuan-turbos-latest', 'hunyuan-t1-latest', 'hunyuan-lite'],
    keyUrl: 'https://console.cloud.tencent.com/hunyuan/api-key',
    color: '#0052d9',
    region: 'cn',
    quirks: { reasoning: 'none' },
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    type: 'openai',
    baseUrl: 'https://api.minimaxi.com/v1',
    models: ['MiniMax-M2'],
    keyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    color: '#e5484d',
    region: 'cn',
    quirks: { reasoning: 'none' },
  },
  {
    id: 'stepfun',
    name: 'StepFun',
    nameZh: '阶跃星辰',
    type: 'openai',
    baseUrl: 'https://api.stepfun.com/v1',
    models: ['step-2-16k', 'step-1-8k'],
    keyUrl: 'https://platform.stepfun.com/interface-key',
    color: '#0ea5e9',
    region: 'cn',
    quirks: { reasoning: 'none' },
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    type: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['openai/gpt-5', 'google/gemini-2.5-pro', 'deepseek/deepseek-chat'],
    keyUrl: 'https://openrouter.ai/keys',
    color: '#6467f2',
    region: 'global',
    headers: { 'X-Title': 'OmniChat' },
    quirks: { reasoning: 'openrouter' },
  },
  {
    id: 'xai',
    name: 'xAI Grok',
    type: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    models: ['grok-4', 'grok-4-fast', 'grok-3-mini'],
    keyUrl: 'https://console.x.ai',
    color: '#111111',
    region: 'global',
    quirks: { reasoning: 'openai' },
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    type: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    models: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest', 'codestral-latest'],
    keyUrl: 'https://console.mistral.ai/api-keys',
    color: '#fa520f',
    region: 'global',
    quirks: { streamUsage: false, reasoning: 'none' },
  },
  {
    id: 'groq',
    name: 'Groq',
    type: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'moonshotai/kimi-k2-instruct'],
    keyUrl: 'https://console.groq.com/keys',
    color: '#f55036',
    region: 'global',
    quirks: { reasoning: 'openai' },
  },
  {
    id: 'together',
    name: 'Together AI',
    type: 'openai',
    baseUrl: 'https://api.together.xyz/v1',
    models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct-Turbo'],
    keyUrl: 'https://api.together.xyz/settings/api-keys',
    color: '#0f6fff',
    region: 'global',
    quirks: { reasoning: 'none' },
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    type: 'openai',
    baseUrl: 'https://api.perplexity.ai',
    models: ['sonar', 'sonar-pro', 'sonar-reasoning-pro'],
    keyUrl: 'https://www.perplexity.ai/settings/api',
    color: '#20808d',
    region: 'global',
    quirks: { streamUsage: false, reasoning: 'none' },
  },
  {
    id: 'github',
    name: 'GitHub Models',
    type: 'openai',
    baseUrl: 'https://models.github.ai/inference',
    models: ['openai/gpt-4.1', 'openai/gpt-4o-mini', 'deepseek/DeepSeek-V3-0324'],
    keyUrl: 'https://github.com/settings/tokens',
    color: '#24292f',
    region: 'global',
    quirks: { reasoning: 'none' },
  },
  {
    id: 'azure',
    name: 'Azure OpenAI',
    type: 'openai',
    baseUrl: 'https://YOUR-RESOURCE.openai.azure.com/openai/v1',
    authStyle: 'api-key',
    models: [],
    keyUrl: 'https://portal.azure.com/',
    color: '#0078d4',
    region: 'global',
    quirks: { maxTokensField: 'max_completion_tokens', reasoning: 'openai' },
  },
  {
    id: 'ollama',
    name: 'Ollama',
    nameZh: 'Ollama（本地模型）',
    type: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    authStyle: 'none',
    mode: 'direct',
    models: [],
    color: '#525252',
    region: 'local',
    noKey: true,
    quirks: { reasoning: 'none' },
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    nameZh: 'LM Studio（本地模型）',
    type: 'openai',
    baseUrl: 'http://localhost:1234/v1',
    authStyle: 'none',
    mode: 'direct',
    models: [],
    color: '#4338ca',
    region: 'local',
    noKey: true,
    quirks: { reasoning: 'none' },
  },
  {
    id: 'custom-openai',
    name: 'Custom (OpenAI-compatible)',
    nameZh: '自定义（OpenAI 兼容）',
    type: 'openai',
    baseUrl: '',
    models: [],
    color: '#64748b',
    region: 'custom',
  },
  {
    id: 'custom-anthropic',
    name: 'Custom (Anthropic-compatible)',
    nameZh: '自定义（Anthropic 兼容）',
    type: 'anthropic',
    baseUrl: '',
    models: [],
    color: '#a16207',
    region: 'custom',
  },
  {
    id: 'custom-gemini',
    name: 'Custom (Gemini-compatible)',
    nameZh: '自定义（Gemini 兼容）',
    type: 'gemini',
    baseUrl: '',
    models: [],
    color: '#0891b2',
    region: 'custom',
  },
];

export const getPreset = (id?: string) => PRESETS.find((p) => p.id === id);

export function getQuirks(provider: { presetId?: string; type: ProviderType }): Quirks {
  return getPreset(provider.presetId)?.quirks ?? {};
}

export function presetName(p: ProviderPreset, lang: 'zh' | 'en') {
  return lang === 'zh' && p.nameZh ? p.nameZh : p.name;
}
