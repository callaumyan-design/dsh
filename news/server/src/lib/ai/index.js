// AI 接口：新闻流程只认 generateJson()，用哪家 AI 由环境变量决定。
//
//   AI_PROVIDER   anthropic | openai | custom | none
//   AI_MODEL      模型名（anthropic 默认 claude-opus-5-5；openai 必填）
//   AI_API_KEY    密钥（anthropic 也可以用 ANTHROPIC_API_KEY）
//   AI_BASE_URL   接口地址（anthropic 可选，用于代理；openai 填兼容接口的根地址；custom 填完整地址）
//   AI_AUTH_HEADER  openai/custom 放密钥的请求头，默认 Authorization: Bearer <key>；Azure OpenAI 填 api-key
//   AI_JSON_MODE  openai 的 JSON 输出方式：json_object（默认）| json_schema | none
//   AI_MAX_TOKENS openai 每次最多输出多少 token（DeepSeek 填 8192；不填就用程序里的默认值）
//
// openai 适用于所有 OpenAI 兼容接口：OpenAI、DeepSeek、通义千问、Kimi、智谱、Ollama、Azure OpenAI 等。
// custom 把 { system, prompt, schema } 原样 POST 到你自己的地址，返回 JSON 即可，可以接任何东西。
import { anthropicProvider } from './anthropic.js';
import { openaiProvider } from './openai.js';
import { customProvider } from './custom.js';

/**
 * @typedef {object} Provider
 * @property {string} name
 * @property {string} model
 * @property {(req: {system: string, prompt: string, schema: object, maxTokens?: number}) => Promise<any>} generateJson
 */

/** 按环境变量创建 AI。没有配置时返回 null（新闻照常更新，只是没有中文摘要）。 */
export function createProvider(env = process.env) {
  const kind = (env.AI_PROVIDER || (env.ANTHROPIC_API_KEY ? 'anthropic' : 'none')).toLowerCase();
  switch (kind) {
    case 'none':
      return null;
    case 'anthropic':
    case 'claude':
      return anthropicProvider(env);
    case 'openai':
    case 'openai-compatible':
      return openaiProvider(env);
    case 'custom':
      return customProvider(env);
    default:
      throw new Error(`不认识的 AI_PROVIDER：${kind}（可选 anthropic、openai、custom、none）`);
  }
}

export { extractJson } from './json.js';
