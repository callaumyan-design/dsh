/**
 * AI avatar generation: call an OpenAI-compatible /images/generations endpoint, then remove
 * the flat background (flood fill from the borders) so the picture works as a desktop pet.
 */
import { joinUrl } from '../ai/openai'
import { friendlyError, ProviderError, type FetchLike } from '../ai/types'

export interface ImageGenConfig {
  baseURL: string
  model: string
  size: string
  /** OpenAI gpt-image-* can return a transparent background directly. */
  transparent?: boolean
}

export const IMAGE_PRESETS: Array<ImageGenConfig & { name: string; keyFrom: string }> = [
  { name: '硅基流动 Kolors（便宜，中文提示词好）', baseURL: 'https://api.siliconflow.cn/v1', model: 'Kwai-Kolors/Kolors', size: '1024x1024', keyFrom: 'siliconflow' },
  { name: 'OpenAI gpt-image-1（支持透明背景）', baseURL: 'https://api.openai.com/v1', model: 'gpt-image-1', size: '1024x1024', keyFrom: 'openai', transparent: true },
  { name: '通义万相（阿里云百炼兼容接口）', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'wanx2.1-t2i-turbo', size: '1024x1024', keyFrom: 'qwen' }
]

/** Wrap the user's description so the model draws a single, centred, sticker-like character. */
export function buildAvatarPrompt(desc: string): string {
  return `${desc.trim()}。可爱的Q版桌面宠物角色，全身，单个角色居中，正面，贴纸风格，粗描边，色彩鲜明，纯白色背景，背景干净无阴影，没有文字`
}

export interface GeneratedImage {
  b64?: string
  url?: string
}

export function parseImageResponse(json: unknown): GeneratedImage | null {
  const j = json as { data?: Array<{ b64_json?: string; url?: string }>; images?: Array<{ url?: string; b64_json?: string }> }
  const first = j?.data?.[0] ?? j?.images?.[0]
  if (!first) return null
  if (first.b64_json) return { b64: first.b64_json }
  if (first.url) return { url: first.url }
  return null
}

export async function generateImage(cfg: ImageGenConfig, prompt: string, apiKey: string, f: FetchLike, signal?: AbortSignal): Promise<Uint8Array> {
  const body: Record<string, unknown> = { model: cfg.model, prompt, size: cfg.size, n: 1 }
  if (cfg.transparent) {
    body.background = 'transparent'
    body.output_format = 'png'
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  let res: Response
  try {
    res = await f(joinUrl(cfg.baseURL, 'images/generations'), { method: 'POST', headers, body: JSON.stringify(body), signal })
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
      /* raw */
    }
    throw new ProviderError(friendlyError(res.status, String(detail)), res.status)
  }
  const img = parseImageResponse(JSON.parse(text))
  if (!img) throw new ProviderError('图片接口没有返回图片')
  if (img.b64) return Uint8Array.from(atob(img.b64), (c) => c.charCodeAt(0))
  const dl = await f(img.url!, { signal })
  if (!dl.ok) throw new ProviderError(`下载生成的图片失败（${dl.status}）`)
  return new Uint8Array(await dl.arrayBuffer())
}

/**
 * Make the background transparent: flood-fill from every border pixel through pixels whose
 * colour is close to the border colour. Operates in place on RGBA data. Returns the number of
 * pixels cleared. A 1px feather softens the cut edge.
 */
export function removeBackground(rgba: Uint8ClampedArray, width: number, height: number, tolerance = 38): number {
  const idx = (x: number, y: number) => (y * width + x) * 4
  // reference colour = median-ish of the four corners
  const corners = [idx(0, 0), idx(width - 1, 0), idx(0, height - 1), idx(width - 1, height - 1)]
  const ref = [0, 1, 2].map((c) => corners.map((i) => rgba[i + c]).sort((a, b) => a - b)[1])
  const tol2 = tolerance * tolerance * 3
  const near = (i: number) => {
    if (rgba[i + 3] < 16) return true
    const dr = rgba[i] - ref[0]
    const dg = rgba[i + 1] - ref[1]
    const db = rgba[i + 2] - ref[2]
    return dr * dr + dg * dg + db * db <= tol2
  }
  const seen = new Uint8Array(width * height)
  const stack: number[] = []
  const push = (x: number, y: number) => {
    const p = y * width + x
    if (!seen[p] && near(p * 4)) {
      seen[p] = 1
      stack.push(p)
    }
  }
  for (let x = 0; x < width; x++) {
    push(x, 0)
    push(x, height - 1)
  }
  for (let y = 0; y < height; y++) {
    push(0, y)
    push(width - 1, y)
  }
  let cleared = 0
  while (stack.length) {
    const p = stack.pop()!
    rgba[p * 4 + 3] = 0
    cleared++
    const x = p % width
    const y = (p - x) / width
    if (x > 0) push(x - 1, y)
    if (x < width - 1) push(x + 1, y)
    if (y > 0) push(x, y - 1)
    if (y < height - 1) push(x, y + 1)
  }
  // feather: half-transparent for opaque pixels touching the cleared area
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = y * width + x
      if (seen[p]) continue
      if (seen[p - 1] || seen[p + 1] || seen[p - width] || seen[p + width]) rgba[p * 4 + 3] = Math.min(rgba[p * 4 + 3], 170)
    }
  }
  return cleared
}

/** Bounding box of pixels with alpha above `threshold`, or null if the image is empty. */
export function alphaBounds(rgba: Uint8ClampedArray, width: number, height: number, threshold = 24): { x: number; y: number; w: number; h: number } | null {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] > threshold) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}
