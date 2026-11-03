import type { ProviderConfig } from './types'

export interface ProviderPreset extends ProviderConfig {
  /** Suggestions shown in the model dropdown; the field stays free-text. */
  models: string[]
  keyUrl?: string
  note?: string
}

/**
 * Common providers. Every OpenAI-compatible service works by editing baseURL/model,
 * these are just shortcuts.
 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'openai',
    baseURL: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    temperature: 1.0,
    keyUrl: 'https://platform.deepseek.com/api_keys',
    note: '默认推荐，便宜，中文好。DeepSeek 没有 Embedding 接口，记忆会用关键词检索。'
  },
  {
    id: 'anthropic',
    name: 'Claude (Anthropic)',
    kind: 'anthropic',
    baseURL: 'https://api.anthropic.com',
    model: 'claude-opus-5-5',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
    effort: 'low',
    useFallbacks: true,
    keyUrl: 'https://console.anthropic.com/settings/keys',
    note: '使用官方 Anthropic SDK。effort 默认 low，适合闲聊；可在设置里调高。'
  },
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-5-mini',
    models: ['gpt-5-mini', 'gpt-5', 'gpt-4.1-mini'],
    keyUrl: 'https://platform.openai.com/api-keys'
  },
  {
    id: 'moonshot',
    name: 'Kimi（月之暗面）',
    kind: 'openai',
    baseURL: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k'],
    temperature: 0.7,
    keyUrl: 'https://platform.moonshot.cn/console/api-keys'
  },
  {
    id: 'qwen',
    name: '通义千问（阿里云百炼）',
    kind: 'openai',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    models: ['qwen-plus', 'qwen-turbo', 'qwen-max'],
    keyUrl: 'https://bailian.console.aliyun.com/'
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    kind: 'openai',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    models: ['glm-4-flash', 'glm-4-plus'],
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys'
  },
  {
    id: 'siliconflow',
    name: '硅基流动 SiliconFlow',
    kind: 'openai',
    baseURL: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V3',
    models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct'],
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    note: '同时提供 Embedding（BAAI/bge-m3），可用于向量记忆。'
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openai',
    baseURL: 'https://openrouter.ai/api/v1',
    model: 'deepseek/deepseek-chat',
    models: ['deepseek/deepseek-chat', 'anthropic/claude-sonnet-5-5', 'openai/gpt-5-mini'],
    keyUrl: 'https://openrouter.ai/keys'
  },
  {
    id: 'ollama',
    name: 'Ollama（本地模型）',
    kind: 'openai',
    baseURL: 'http://localhost:11434/v1',
    model: 'qwen2.5:7b',
    models: ['qwen2.5:7b', 'llama3.1:8b'],
    noKey: true,
    note: '完全离线。先安装 Ollama 并 ollama pull 对应模型。'
  }
]

export function presetToConfig(p: ProviderPreset): ProviderConfig {
  const { models: _m, keyUrl: _k, note: _n, ...cfg } = p
  return { ...cfg }
}

export function defaultProviders(): ProviderConfig[] {
  return PROVIDER_PRESETS.map(presetToConfig)
}

export const EMBEDDING_PRESETS = [
  { name: '硅基流动 bge-m3（免费）', baseURL: 'https://api.siliconflow.cn/v1', model: 'BAAI/bge-m3' },
  { name: 'OpenAI text-embedding-3-small', baseURL: 'https://api.openai.com/v1', model: 'text-embedding-3-small' },
  { name: '通义 text-embedding-v3', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'text-embedding-v3' },
  { name: 'Ollama nomic-embed-text（本地）', baseURL: 'http://localhost:11434/v1', model: 'nomic-embed-text' }
]
