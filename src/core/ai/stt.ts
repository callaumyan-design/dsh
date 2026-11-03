/**
 * Speech-to-text through any OpenAI-compatible `/audio/transcriptions` endpoint
 * (SiliconFlow SenseVoice, OpenAI Whisper / gpt-4o-transcribe, Groq Whisper, local servers).
 * The multipart body is built by hand so it works with any fetch implementation.
 */
import { joinUrl } from './openai'
import { friendlyError, ProviderError, type FetchLike } from './types'

export interface SttConfig {
  baseURL: string
  model: string
  language?: string
}

export const STT_PRESETS: Array<SttConfig & { name: string; keyFrom: string }> = [
  { name: '硅基流动 SenseVoice（免费，中文好）', baseURL: 'https://api.siliconflow.cn/v1', model: 'FunAudioLLM/SenseVoiceSmall', keyFrom: 'siliconflow' },
  { name: 'OpenAI gpt-4o-mini-transcribe', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini-transcribe', keyFrom: 'openai' },
  { name: 'OpenAI whisper-1', baseURL: 'https://api.openai.com/v1', model: 'whisper-1', keyFrom: 'openai' },
  { name: 'Groq whisper-large-v3（快）', baseURL: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3', keyFrom: 'own' },
  { name: '本地 Whisper 服务（如 faster-whisper-server）', baseURL: 'http://localhost:8000/v1', model: 'Systran/faster-whisper-small', keyFrom: 'own' }
]

export function buildMultipart(fields: Record<string, string>, file: { name: string; type: string; data: Uint8Array }, boundary: string): Uint8Array {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  for (const [k, v] of Object.entries(fields)) {
    parts.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`))
  }
  parts.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`))
  parts.push(file.data)
  parts.push(enc.encode(`\r\n--${boundary}--\r\n`))
  const total = parts.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

/** SenseVoice may prefix tags like <|zh|><|NEUTRAL|>; strip them. */
export function cleanTranscript(text: string): string {
  return text.replace(/<\|[^|]*\|>/g, '').replace(/\s+/g, ' ').trim()
}

export async function transcribe(cfg: SttConfig, audio: Uint8Array, mime: string, apiKey: string, f: FetchLike = fetch, signal?: AbortSignal): Promise<string> {
  if (!audio.length) throw new ProviderError('没有录到声音')
  const boundary = `----soulpet${Math.random().toString(16).slice(2)}`
  const ext = mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : mime.includes('mp4') ? 'm4a' : 'webm'
  const fields: Record<string, string> = { model: cfg.model, response_format: 'json' }
  if (cfg.language) fields.language = cfg.language
  const body = buildMultipart(fields, { name: `speech.${ext}`, type: mime || 'audio/webm', data: audio }, boundary)
  const headers: Record<string, string> = { 'Content-Type': `multipart/form-data; boundary=${boundary}` }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  let res: Response
  try {
    res = await f(joinUrl(cfg.baseURL, 'audio/transcriptions'), { method: 'POST', headers, body: body as unknown as BodyInit, signal })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ProviderError(friendlyError(undefined, (e as Error).message))
  }
  const text = await res.text()
  if (!res.ok) {
    let detail = text
    try {
      const j = JSON.parse(text)
      detail = j?.error?.message ?? j?.message ?? text
    } catch {
      /* raw text */
    }
    throw new ProviderError(friendlyError(res.status, String(detail)), res.status)
  }
  try {
    const j = JSON.parse(text)
    return cleanTranscript(String(j.text ?? ''))
  } catch {
    return cleanTranscript(text)
  }
}
