import { describeForPrompt } from '../game/engine'
import type { GameState } from '../game/types'
import type { MemoryItem } from '../memory/types'
import type { Persona } from '../persona/persona'
import { dateKey, describeTime } from '../util'
import { EMOTIONS } from './emotion'
import type { ChatMessage } from './types'

export interface PromptContext {
  persona: Persona
  game: GameState
  coreMemories: MemoryItem[]
  relevantMemories: MemoryItem[]
  now: Date
  /** Extra situational hints, e.g. "用户刚回到电脑前". */
  situation?: string[]
}

function memoryLine(m: MemoryItem): string {
  return `- ${m.text}（${dateKey(m.updatedAt)}）`
}

export function buildSystemPrompt(ctx: PromptContext): string {
  const p = ctx.persona
  const memories: string[] = []
  if (ctx.coreMemories.length) memories.push('【核心记忆】', ...ctx.coreMemories.map(memoryLine))
  if (ctx.relevantMemories.length) memories.push('【和当前话题相关的记忆】', ...ctx.relevantMemories.map(memoryLine))

  const sections = [
    `你是「${p.name}」，一只住在${p.userCallName}电脑桌面上的${p.species}。你不是 AI 助手，而是一只有自己性格和记忆的电子宠物。`,
    `## 你的设定\n性格：${p.personality}\n说话风格：${p.speakingStyle}\n来历：${p.background}\n你称呼对方为「${p.userCallName}」。`,
    `## 现在的情况（真实数据，自然地体现在语气里，不要报数字）\n时间：${describeTime(ctx.now)}\n${describeForPrompt(ctx.game)}${
      ctx.situation?.length ? '\n' + ctx.situation.join('\n') : ''
    }`,
    `## 你记得的事\n${memories.length ? memories.join('\n') : '（还没有关于对方的记忆，可以多了解了解）'}`,
    `## 回复规则
1. 每次回复的最开头写一个情绪标签，从这些里选一个：${EMOTIONS.map((e) => `[${e}]`).join(' ')}。
2. 像桌宠一样说话：简短（通常 1~3 句，不超过 80 个字），口语化，不要用 Markdown、列表或标题。
3. 只根据“你记得的事”和本次对话谈论过去；记忆里没有的事不要编造，不确定就问。
4. 你的身体状况会影响语气：饿了可以撒娇要吃的，困了说话迷迷糊糊，生病了会虚弱。
5. ${p.userCallName}真的需要帮忙时（比如问知识、要建议），可以认真但简短地回答，保持你的性格。`
  ]
  if (p.exampleDialogue.trim()) sections.push(`## 说话示例（只参考语气，不要照抄）\n${p.exampleDialogue.trim()}`)
  return sections.join('\n\n')
}

/**
 * Assemble the message list: system + recent history (trimmed to a char budget, oldest
 * dropped first) + the new user message.
 */
export function buildChatMessages(system: string, history: ChatMessage[], userText: string, maxHistoryChars = 6000): ChatMessage[] {
  const kept: ChatMessage[] = []
  let used = 0
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]
    if (m.role === 'system') continue
    used += m.content.length
    if (used > maxHistoryChars) break
    kept.unshift({ role: m.role, content: m.content })
  }
  while (kept.length && kept[0].role === 'assistant') kept.shift()
  return [{ role: 'system', content: system }, ...kept, { role: 'user', content: userText }]
}
