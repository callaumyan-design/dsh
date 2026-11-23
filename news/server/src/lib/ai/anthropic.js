import Anthropic from '@anthropic-ai/sdk';

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';

// 这些模型支持服务端拒绝回退（被安全分类器误拒时自动换推荐的模型重试）。
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-fable-5-2', 'claude-fable-5-1']);

export function anthropicProvider(env, { client } = {}) {
  const apiKey = env.AI_API_KEY || env.ANTHROPIC_API_KEY;
  const model = env.AI_MODEL || DEFAULT_CLAUDE_MODEL;
  client ??= new Anthropic({ apiKey, ...(env.AI_BASE_URL ? { baseURL: env.AI_BASE_URL } : {}) });
  const fallback = FALLBACK_MODELS.has(model);

  return {
    name: 'anthropic',
    model,
    async generateJson({ system, prompt, schema, maxTokens = 16000 }) {
      const response = await client.beta.messages.create({
        model,
        max_tokens: maxTokens,
        ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
        output_config: { format: { type: 'json_schema', schema } },
        system,
        messages: [{ role: 'user', content: prompt }],
      });
      if (response.stop_reason === 'refusal') {
        throw new Error(`Claude 拒绝了请求（${response.stop_details?.category ?? '未说明原因'}）`);
      }
      if (response.stop_reason === 'max_tokens') throw new Error('Claude 的输出被 max_tokens 截断');
      const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      return JSON.parse(text);
    },
  };
}
