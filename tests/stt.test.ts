import { describe, expect, it } from 'vitest'
import { buildMultipart, cleanTranscript, transcribe } from '../src/core/ai/stt'

describe('speech-to-text', () => {
  it('builds a valid multipart body', () => {
    const body = new TextDecoder().decode(buildMultipart({ model: 'm' }, { name: 'a.webm', type: 'audio/webm', data: new Uint8Array([65, 66]) }, 'XX'))
    expect(body).toBe(
      '--XX\r\nContent-Disposition: form-data; name="model"\r\n\r\nm\r\n' +
        '--XX\r\nContent-Disposition: form-data; name="file"; filename="a.webm"\r\nContent-Type: audio/webm\r\n\r\nAB\r\n--XX--\r\n'
    )
  })

  it('posts audio and cleans SenseVoice tags', async () => {
    let seen: { url: string; headers: Record<string, string>; size: number } | null = null
    const fakeFetch = async (url: string, init?: RequestInit) => {
      seen = { url, headers: init?.headers as Record<string, string>, size: (init?.body as Uint8Array).length }
      return new Response(JSON.stringify({ text: '<|zh|><|NEUTRAL|><|Speech|>你好呀 ' }), { status: 200 })
    }
    const text = await transcribe({ baseURL: 'https://stt.example/v1', model: 'sv' }, new Uint8Array(100), 'audio/webm;codecs=opus', 'k', fakeFetch)
    expect(text).toBe('你好呀')
    expect(seen!.url).toBe('https://stt.example/v1/audio/transcriptions')
    expect(seen!.headers['Content-Type']).toMatch(/^multipart\/form-data; boundary=/)
    expect(seen!.headers.Authorization).toBe('Bearer k')
    expect(seen!.size).toBeGreaterThan(100)
  })

  it('reports errors and empty audio', async () => {
    const bad = async () => new Response('{"error":{"message":"invalid model"}}', { status: 404 })
    await expect(transcribe({ baseURL: 'x', model: 'm' }, new Uint8Array(5), 'audio/webm', '', bad)).rejects.toThrow(/模型名不对/)
    await expect(transcribe({ baseURL: 'x', model: 'm' }, new Uint8Array(0), 'audio/webm', '')).rejects.toThrow(/没有录到/)
    expect(cleanTranscript('  <|en|> hi  there ')).toBe('hi there')
  })
})
