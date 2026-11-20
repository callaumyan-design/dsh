// Which thinking-effort levels the current model accepts, mirroring how each adapter maps the setting onto its API.
import { goProtocol, isOpencodeGo } from '../../../shared/opencode-go';
import { claudeInfo, geminiThinkingStyle, guessReasoning } from './capabilities';
import { getQuirks } from './presets';
import type { Provider, ReasoningEffort } from '../types';

export interface ReasoningOptions {
  /** Levels to offer besides "default". */
  efforts: ReasoningEffort[];
  /** The API only switches thinking on or off: 'none' is off and 'high' is on. */
  onOff?: boolean;
}

const LMH: ReasoningEffort[] = ['low', 'medium', 'high'];

function claudeOptions(model: string): ReasoningOptions {
  if (!/claude/i.test(model)) return { efforts: LMH }; // Anthropic-compatible vendors: budget-based thinking
  const info = claudeInfo(model);
  if (!info.adaptive) return { efforts: [...LMH, 'max'] }; // no thinking unless asked, so 'default' is already off
  return { efforts: [...(info.canDisable ? (['none'] as ReasoningEffort[]) : []), ...LMH, 'xhigh', 'max'] };
}

function geminiOptions(model: string): ReasoningOptions | null {
  const style = geminiThinkingStyle(model);
  if (style === 'none') return null;
  if (style === 'level') return { efforts: ['low', 'high'] };
  return { efforts: [...(/pro/i.test(model) ? [] : (['none'] as ReasoningEffort[])), ...LMH, 'max'] };
}

/** OpenAI-style reasoning_effort / reasoning.effort, by model family. */
function openaiOptions(model: string, responses: boolean): ReasoningOptions | null {
  const m = model.toLowerCase().replace(/^.*\//, '');
  const v = /^gpt-(\d+)(?:\.(\d+))?/.exec(m);
  if (v && Number(v[1]) >= 5) {
    const version = Number(v[1]) + (v[2] ? Number(v[2]) / 10 : 0);
    if (version < 5.1) return { efforts: ['minimal', ...LMH] };
    if (version < 5.2) return { efforts: ['none', ...LMH] };
    return { efforts: ['none', ...LMH, ...(responses ? (['xhigh'] as ReasoningEffort[]) : [])] };
  }
  if (/^o[1-9]/.test(m) || /gpt-oss/.test(m)) return { efforts: LMH };
  if (/^grok-3-mini/.test(m)) return { efforts: ['low', 'high'] };
  if (/^grok-/.test(m)) return null; // Grok 4+ reasons on its own and rejects the parameter
  return guessReasoning(m) ? { efforts: LMH } : null;
}

export function reasoningOptions(p: Provider, model: string): ReasoningOptions | null {
  if (isOpencodeGo(p)) {
    switch (goProtocol(model)) {
      case 'anthropic':
        return claudeOptions(model);
      case 'gemini':
        return geminiOptions(model);
      case 'responses':
        return openaiOptions(model, true);
      default:
        return { efforts: LMH };
    }
  }
  if (p.type === 'anthropic') return claudeOptions(model);
  if (p.type === 'gemini') return geminiOptions(model);
  if (p.useResponsesApi) return openaiOptions(model, true);
  const reasoning = guessReasoning(model);
  switch (getQuirks(p).reasoning ?? 'openai') {
    case 'openai':
      return openaiOptions(model, false);
    case 'lmh':
      return { efforts: LMH };
    case 'openrouter':
      return reasoning ? { efforts: ['none', ...LMH] } : null;
    case 'enable_thinking':
    case 'thinking_type':
      return reasoning ? { efforts: ['none', 'high'], onOff: true } : null;
    default:
      return null;
  }
}

/** i18n key of an effort level; on/off APIs show 'none' and 'high' as off / on. */
export function effortLabel(e: ReasoningEffort, onOff?: boolean): string {
  if (onOff && e === 'none') return 'effort.off';
  if (onOff && e === 'high') return 'effort.on';
  return `effort.${e}`;
}
