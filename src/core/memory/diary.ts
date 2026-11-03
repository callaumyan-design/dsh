/**
 * Daily diary + reflection (Generative Agents style): once a day the pet writes a short
 * diary about the day and distils 0-3 higher-level insights, which become memories.
 */
import { extractJson } from '../ai/client'
import type { ChatMessage } from '../ai/types'
import type { Persona } from '../persona/persona'

export function buildDiaryMessages(args: {
  persona: Persona
  date: string
  chat: ChatMessage[]
  activities: string[]
  status: string
}): ChatMessage[] {
  const p = args.persona
  const convo = args.chat
    .filter((m) => m.role !== 'system')
    .slice(-60)
    .map((m) => `${m.role === 'user' ? p.userCallName : p.name}：${m.content}`)
    .join('\n')
  const system = `你是「${p.name}」，${p.species}。性格：${p.personality} 说话风格：${p.speakingStyle}
现在是晚上，你要写一篇 ${args.date} 的日记。用第一人称，口语化，像小宠物写的，150 字以内，可以提到今天和${p.userCallName}聊了什么、被喂了什么、心情怎样。
然后提炼 0~3 条对${p.userCallName}的新认识（insights，例如“${p.userCallName}最近工作压力很大”），只写确实从今天的内容里能看出来的，用第三人称写成一句话，用“用户”指代。
只输出 JSON：{"diary":"...","insights":["..."]}`
  const user = `今天发生的事：
${args.activities.length ? args.activities.map((a) => `- ${a}`).join('\n') : '（没有特别的事）'}

今天的聊天：
${convo || '（今天没怎么聊天）'}

你现在的状态：
${args.status}`
  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ]
}

export function parseDiary(text: string): { diary: string; insights: string[] } | null {
  const j = extractJson<{ diary?: unknown; insights?: unknown }>(text)
  if (j && typeof j.diary === 'string' && j.diary.trim()) {
    const insights = Array.isArray(j.insights) ? j.insights.filter((s): s is string => typeof s === 'string' && !!s.trim()).slice(0, 3) : []
    return { diary: j.diary.trim(), insights }
  }
  const plain = text.trim()
  return plain && !plain.startsWith('{') ? { diary: plain, insights: [] } : null
}
