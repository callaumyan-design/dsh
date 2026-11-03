/** Read pixel dimensions from PNG / GIF / WebP / JPEG headers (no decoding). */
export interface Size {
  width: number
  height: number
  type: 'png' | 'gif' | 'webp' | 'jpeg'
}

export function imageSize(b: Uint8Array): Size | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const ascii = (o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n))
  if (b.length >= 24 && b[0] === 0x89 && ascii(1, 3) === 'PNG') {
    return { width: dv.getUint32(16), height: dv.getUint32(20), type: 'png' }
  }
  if (b.length >= 10 && ascii(0, 3) === 'GIF') {
    return { width: dv.getUint16(6, true), height: dv.getUint16(8, true), type: 'gif' }
  }
  if (b.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4)
    if (chunk === 'VP8X') return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)), type: 'webp' }
    if (chunk === 'VP8L') {
      const bits = dv.getUint32(21, true)
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, type: 'webp' }
    }
    if (chunk === 'VP8 ') return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff, type: 'webp' }
    return null
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let o = 2
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) return null
      const marker = b[o + 1]
      const len = dv.getUint16(o + 2)
      // SOF0..SOF15 except DHT(C4), JPG(C8), DAC(CC)
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: dv.getUint16(o + 7), height: dv.getUint16(o + 5), type: 'jpeg' }
      }
      o += 2 + len
    }
  }
  return null
}

/** Fit an image into a pet-sized box (longest side `max`), keeping aspect ratio. */
export function fitSize(s: { width: number; height: number }, max = 190, min = 80): [number, number] {
  const k = Math.min(max / s.width, max / s.height)
  const w = Math.round(s.width * k)
  const h = Math.round(s.height * k)
  return [Math.max(min, w), Math.max(min, h)]
}
