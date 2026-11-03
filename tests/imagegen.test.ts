import { describe, expect, it } from 'vitest'
import { alphaBounds, buildAvatarPrompt, generateImage, parseImageResponse, removeBackground } from '../src/core/pets/imagegen'

/** 20x20 white image with a red 6x6 square at (7,7) */
function sample(): Uint8ClampedArray {
  const w = 20
  const d = new Uint8ClampedArray(w * w * 4).fill(255)
  for (let y = 7; y < 13; y++) for (let x = 7; x < 13; x++) d.set([220, 30, 30, 255], (y * w + x) * 4)
  return d
}

describe('background removal', () => {
  it('clears the connected background and keeps the subject', () => {
    const d = sample()
    const cleared = removeBackground(d, 20, 20)
    expect(cleared).toBe(400 - 36)
    expect(d[3]).toBe(0) // corner transparent
    expect(d[(10 * 20 + 10) * 4 + 3]).toBe(255) // centre of the square opaque
    expect(d[(7 * 20 + 7) * 4 + 3]).toBe(170) // edge feathered
    expect(alphaBounds(d, 20, 20)).toEqual({ x: 7, y: 7, w: 6, h: 6 })
  })

  it('keeps white areas enclosed by the subject (e.g. eyes)', () => {
    const w = 20
    const d = sample()
    d.set([255, 255, 255, 255], (10 * w + 10) * 4) // white pixel inside the red square
    removeBackground(d, w, w)
    expect(d[(10 * w + 10) * 4 + 3]).toBe(255)
  })

  it('alphaBounds returns null for an empty image', () => {
    expect(alphaBounds(new Uint8ClampedArray(16), 2, 2)).toBeNull()
  })
})

describe('image generation client', () => {
  it('parses b64 and url responses', () => {
    expect(parseImageResponse({ data: [{ b64_json: 'QUJD' }] })).toEqual({ b64: 'QUJD' })
    expect(parseImageResponse({ images: [{ url: 'https://x/y.png' }] })).toEqual({ url: 'https://x/y.png' })
    expect(parseImageResponse({})).toBeNull()
    expect(buildAvatarPrompt('小猫')).toMatch(/^小猫。.*纯白色背景/)
  })

  it('requests a transparent PNG from gpt-image and downloads url results', async () => {
    const calls: Array<{ url: string; body?: any }> = []
    const f = async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (url.endsWith('/images/generations')) return new Response(JSON.stringify({ images: [{ url: 'https://cdn.example/a.png' }] }), { status: 200 })
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
    }
    const bytes = await generateImage({ baseURL: 'https://api.example/v1', model: 'gpt-image-1', size: '1024x1024', transparent: true }, 'p', 'k', f)
    expect([...bytes]).toEqual([1, 2, 3])
    expect(calls[0].body).toMatchObject({ model: 'gpt-image-1', background: 'transparent', output_format: 'png', n: 1 })
    expect(calls[1].url).toBe('https://cdn.example/a.png')
  })

  it('decodes base64 results and surfaces API errors', async () => {
    const ok = async () => new Response(JSON.stringify({ data: [{ b64_json: btoa('PNG') }] }), { status: 200 })
    expect(new TextDecoder().decode(await generateImage({ baseURL: 'x', model: 'm', size: 's' }, 'p', '', ok))).toBe('PNG')
    const bad = async () => new Response('{"error":{"message":"bad key"}}', { status: 401 })
    await expect(generateImage({ baseURL: 'x', model: 'm', size: 's' }, 'p', '', bad)).rejects.toThrow(/API Key 无效/)
  })
})
