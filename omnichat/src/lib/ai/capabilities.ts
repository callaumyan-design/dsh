// Best-effort capability hints derived from model names (used for badges and warnings only).

export function guessVision(model: string): boolean {
  const m = model.toLowerCase();
  return /gpt-4o|gpt-4\.1|gpt-4-turbo|vision|gpt-5|(^|\/)o[34]\b|o3-|o4-|claude|gemini|gemma-3|-vl\b|-vl-|vl-|qwen-vl|qwen3-vl|qwen2\.5-vl|glm-4v|glm-4\.\dv|grok-4|grok-2-vision|pixtral|llava|minicpm-v|llama-4|kimi-latest|vision-preview|doubao-seed|step-1v|internvl|mistral-medium|mistral-small/.test(
    m,
  );
}

export function guessReasoning(model: string): boolean {
  const m = model.toLowerCase();
  return /(^|\/)o[1345](\b|-)|gpt-5|reasoner|-r1|r1-|thinking|qwq|qwen3|claude-(opus|sonnet|haiku)-[4-9]|claude-(fable|mythos)|claude-3-7|gemini-2\.5|gemini-[3-9]|grok-3-mini|grok-4|glm-4\.[56]|ernie-x1|hunyuan-t1|deepseek-v3\.[12]|gpt-oss|magistral|sonar-reasoning|minimax-m\d|doubao-seed/.test(
    m,
  );
}

export interface ClaudeInfo {
  /** Uses adaptive thinking + effort (Claude 4.6 and later). */
  adaptive: boolean;
  /** Accepts thinking: {type: "disabled"}. */
  canDisable: boolean;
  /** Accepts temperature / top_p. */
  sampling: boolean;
  legacyMaxTokens: number;
}

export function claudeInfo(model: string): ClaudeInfo {
  const m = model.toLowerCase();
  const fam = /claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2}))?(?!\d)/.exec(m);
  if (!fam) {
    // Legacy naming (claude-3-5-sonnet-…) or a non-Claude model behind an Anthropic-compatible API.
    return { adaptive: false, canDisable: true, sampling: true, legacyMaxTokens: /claude-3-(haiku|opus|sonnet)/.test(m) ? 4096 : 8192 };
  }
  const family = fam[1];
  const major = Number(fam[2]);
  const minor = fam[3] ? Number(fam[3]) : 0;
  const version = major + minor / 10;
  const adaptive = family === 'fable' || family === 'mythos' || version >= 4.6;
  const canDisable = !(family === 'fable' || family === 'mythos' || (version >= 5.5 && family !== 'haiku') || version >= 6);
  return { adaptive, canDisable, sampling: version < 4.7 && family !== 'fable' && family !== 'mythos', legacyMaxTokens: 8192 };
}

export type GeminiThinking = 'level' | 'budget' | 'none';

export function geminiThinkingStyle(model: string): GeminiThinking {
  const m = model.toLowerCase();
  const v = /gemini-(\d+(?:\.\d+)?)/.exec(m);
  if (!v) return /thinking/.test(m) ? 'budget' : 'none';
  const n = Number(v[1]);
  if (n >= 3) return 'level';
  if (n >= 2.5) return 'budget';
  return /thinking/.test(m) ? 'budget' : 'none';
}
