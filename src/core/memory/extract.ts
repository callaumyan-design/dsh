/**
 * Memory write path, modelled on mem0: after a conversation turn, show the LLM the new
 * turns plus the most related existing memories and ask for ADD / UPDATE / DELETE ops.
 * This keeps the store de-duplicated and lets new facts overwrite stale ones.
 */
import { extractJson } from '../ai/client'
import type { ChatMessage } from '../ai/types'
import { dateKey } from '../util'
import type { MemoryStore } from './store'
import type { MemoryItem, MemoryType } from './types'

export type MemoryOp =
  | { op: 'add'; text: string; type?: MemoryType; importance?: number }
  | { op: 'update'; id: string; text: string; importance?: number }
  | { op: 'delete'; id: string }

const VALID_TYPES: MemoryType[] = ['fact', 'preference', 'event', 'self']

export function buildExtractionMessages(args: {
  petName: string
  userCallName: string
  turns: ChatMessage[]
  related: MemoryItem[]
  now: number
}): ChatMessage[] {
  const related = args.related.length
    ? args.related.map((m) => `- ${m.id}: ${m.text}`).join('\n')
    : '（暂无）'
  const convo = args.turns
    .filter((t) => t.role !== 'system')
    .map((t) => `${t.role === 'user' ? '用户' : args.petName}：${t.content}`)
    .join('\n')
  const system = `你是桌宠「${args.petName}」的记忆管理员。你的任务是根据最新对话，决定长期记忆库要怎样修改。今天是 ${dateKey(args.now)}。

值得记住的：用户的身份、名字、生日、工作学习、家人朋友与宠物、喜好和讨厌的东西、习惯、近期计划和重要经历、你们之间的约定；以及用户给「${args.petName}」设定的新信息。
不要记：寒暄、一次性的问题、宠物自己随口说的话（承诺和约定除外）、已经在记忆库里的重复信息。

已有的相关记忆（id: 内容）：
${related}

规则：
1. 每条记忆是一句完整的话，用第三人称写（用“用户”指代对方），必要时带上日期，例如“用户说 ${dateKey(args.now)} 下周要考英语”。
2. 新信息和已有记忆矛盾或更新时，用 update 改写那条（只能用上面列出的 id）。
3. 用户明确要求“记住……”时必须 add，importance ≥ 8。用户要求忘掉某件事时，delete 对应记忆。
4. importance：1=琐碎，5=一般，8=重要，10=核心身份信息。
5. type 只能是 fact / preference / event / self（self 表示关于宠物自己的设定）。

只输出 JSON，不要解释：
{"ops":[{"op":"add","text":"...","type":"preference","importance":6},{"op":"update","id":"m_xxx","text":"..."},{"op":"delete","id":"m_xxx"}]}
没有需要修改的就输出 {"ops":[]}`
  return [
    { role: 'system', content: system },
    { role: 'user', content: `最新对话：\n${convo}` }
  ]
}

export function parseMemoryOps(text: string): MemoryOp[] {
  const j = extractJson<{ ops?: unknown[] }>(text)
  if (!j || !Array.isArray(j.ops)) return []
  const ops: MemoryOp[] = []
  for (const raw of j.ops) {
    if (!raw || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    const importance = typeof o.importance === 'number' ? o.importance : undefined
    if (o.op === 'add' && typeof o.text === 'string' && o.text.trim()) {
      const type = VALID_TYPES.includes(o.type as MemoryType) ? (o.type as MemoryType) : 'fact'
      ops.push({ op: 'add', text: o.text.trim(), type, importance })
    } else if (o.op === 'update' && typeof o.id === 'string' && typeof o.text === 'string' && o.text.trim()) {
      ops.push({ op: 'update', id: o.id, text: o.text.trim(), importance })
    } else if (o.op === 'delete' && typeof o.id === 'string') {
      ops.push({ op: 'delete', id: o.id })
    }
  }
  return ops
}

export interface ApplySummary {
  added: string[]
  updated: string[]
  deleted: string[]
}

/** Apply ops; update/delete are only allowed on memories that were shown to the model. */
export function applyMemoryOps(store: MemoryStore, ops: MemoryOp[], allowedIds: Set<string>, now: number): ApplySummary {
  const summary: ApplySummary = { added: [], updated: [], deleted: [] }
  for (const op of ops) {
    if (op.op === 'add') {
      const pinned = (op.importance ?? 0) >= AUTO_PIN_IMPORTANCE && store.core(50).length < 12
      const r = store.add({ text: op.text, type: op.type, importance: op.importance ?? 5, source: 'auto', pinned }, now)
      ;(r.merged ? summary.updated : summary.added).push(r.item.id)
    } else if (op.op === 'update' && allowedIds.has(op.id)) {
      const target = store.get(op.id)
      if (target?.pinned && target.source === 'user') continue // never let the model rewrite hand-pinned core memories
      if (store.update(op.id, { text: op.text, importance: op.importance }, now)) summary.updated.push(op.id)
    } else if (op.op === 'delete' && allowedIds.has(op.id)) {
      const target = store.get(op.id)
      if (target?.pinned && target.source === 'user') continue
      if (store.remove(op.id)) summary.deleted.push(op.id)
    }
  }
  return summary
}

const REMEMBER_RE = /(?:^|[，,。!！\s])(?:请|帮我|你要|你得)?(?:记住|记得|别忘了|不要忘了)[：:，,\s]*(.{2,120})$/
const REMEMBER_EN = /\bremember(?:\s+that)?\s+(.{2,160})$/i

/** "记住我生日是3月5号" -> "我生日是3月5号". Used to store explicit requests immediately. */
export function detectExplicitRemember(userText: string): string | null {
  const t = userText.trim()
  const m = REMEMBER_RE.exec(t) ?? REMEMBER_EN.exec(t)
  if (!m) return null
  if (/[吗么?？]\s*$/.test(m[1])) return null // "记得我喜欢什么吗？" is a question, not a request
  const content = m[1].replace(/[。.!！~～]+$/, '').trim()
  if (content.length < 2 || /^(吗|没|了吗|住了吗)/.test(content)) return null
  return content
}

/** Turn "我喜欢草莓" into a third-person memory sentence. */
export function toThirdPerson(content: string): string {
  return content.replace(/^我的/, '用户的').replace(/^我/, '用户').replace(/(?<=[，,、])我/g, '用户')
}

const TRIVIAL = /^(嗯+|哦+|噢+|啊+|哈+|呵+|嘿+|嗯嗯|好+的?|好吧|行|可以|ok|okay|谢谢|谢了|晚安|早安|早|拜拜|再见|在吗|在不在|是的?|对的?|没事|没有|不用|收到|知道了|666|hh+|233+|[\p{P}\p{S}\s]+)$/iu

/** Cheap filter: does this user message possibly contain something worth remembering? */
export function worthExtracting(userText: string): boolean {
  const t = userText.trim()
  if (!t) return false
  if (TRIVIAL.test(t)) return false
  const visible = t.replace(/[\p{P}\p{S}\s]/gu, '')
  if (visible.length >= 6) return true
  // short but personal: "我叫小明" / "我18岁" / "明天考试"
  return /[我咱俺]|名字|叫|生日|岁|住|喜欢|讨厌|明天|后天|下周|\d/.test(t)
}

/** Identity-level facts the model rates 9-10 are pinned automatically (always in context). */
export const AUTO_PIN_IMPORTANCE = 9
