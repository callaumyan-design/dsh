/**
 * Import SillyTavern / Character Card (V1, V2 `chara_card_v2`, V3 `chara_card_v3`) into a Persona.
 * Cards come as JSON or as PNG with the JSON base64-encoded in a tEXt chunk ("chara" or "ccv3").
 */
import type { Persona } from './persona'

interface CardData {
  name?: string
  description?: string
  personality?: string
  scenario?: string
  first_mes?: string
  mes_example?: string
  creator_notes?: string
}

export function isPng(buf: Uint8Array): boolean {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  return buf.length > 8 && sig.every((b, i) => buf[i] === b)
}

/** Read all tEXt chunks of a PNG as { keyword: text }. */
export function readPngText(buf: Uint8Array): Record<string, string> {
  if (!isPng(buf)) throw new Error('不是 PNG 文件')
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const out: Record<string, string> = {}
  let off = 8
  const latin1 = new TextDecoder('latin1')
  while (off + 12 <= buf.length) {
    const len = view.getUint32(off)
    const type = String.fromCharCode(buf[off + 4], buf[off + 5], buf[off + 6], buf[off + 7])
    const dataStart = off + 8
    const dataEnd = dataStart + len
    if (dataEnd > buf.length) break
    if (type === 'tEXt') {
      const data = buf.subarray(dataStart, dataEnd)
      const zero = data.indexOf(0)
      if (zero > 0) out[latin1.decode(data.subarray(0, zero))] = latin1.decode(data.subarray(zero + 1))
    }
    if (type === 'IEND') break
    off = dataEnd + 4 // skip CRC
  }
  return out
}

function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64.trim())
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

export function cardJsonFromPng(buf: Uint8Array): unknown {
  const text = readPngText(buf)
  const raw = text.ccv3 ?? text.chara
  if (!raw) throw new Error('这张 PNG 里没有角色卡数据')
  return JSON.parse(decodeBase64Utf8(raw))
}

export function personaFromCard(json: unknown, userCallName = '你'): Partial<Persona> {
  if (!json || typeof json !== 'object') throw new Error('角色卡格式不正确')
  const obj = json as { spec?: string; data?: CardData } & CardData
  const data: CardData = typeof obj.spec === 'string' && obj.spec.startsWith('chara_card') && obj.data ? obj.data : obj
  if (!data.name) throw new Error('角色卡缺少 name 字段')
  const name = data.name
  const sub = (s?: string) =>
    (s ?? '')
      .replace(/\{\{char\}\}|<BOT>/gi, name)
      .replace(/\{\{user\}\}|<USER>/gi, userCallName)
      .trim()
  const personality = [sub(data.personality), sub(data.description)].filter(Boolean).join('\n')
  return {
    name,
    personality: personality || undefined,
    background: sub(data.scenario) || undefined,
    greeting: sub(data.first_mes) || undefined,
    exampleDialogue: sub(data.mes_example) || undefined
  }
}

export function personaFromCardFile(buf: Uint8Array, userCallName?: string): Partial<Persona> {
  if (isPng(buf)) return personaFromCard(cardJsonFromPng(buf), userCallName)
  return personaFromCard(JSON.parse(new TextDecoder('utf-8').decode(buf)), userCallName)
}
