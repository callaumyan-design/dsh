import jsQR from 'jsqr';

/**
 * 二维码识别：全部在浏览器本地完成，图片和摄像头画面不会离开本机。
 *
 * - 优先使用浏览器内置的 BarcodeDetector（Android / macOS / ChromeOS 上的 Chrome 有）；
 * - 否则用 jsQR（纯 JS，Apache-2.0）解码，Windows / Linux 上的 Chrome 走这条路。
 */

export class QrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QrError';
  }
}

/**
 * 从二维码内容中取出激活码。支持：
 * - 直接的 `LPA:1$…`（GSMA SGP.22 标准二维码内容）；
 * - 包在链接里的激活码，例如 Apple 的
 *   `https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=LPA:1$…`（可能经过 URL 编码）。
 */
export function extractActivationCode(content: string): string {
  const text = content.trim();
  if (/^(LPA:)?1\$/i.test(text)) return text.replace(/^lpa:/i, 'LPA:');
  let decoded = text;
  for (let i = 0; i < 2; i++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  const m = decoded.match(/LPA:1\$[^\s&"'<>#]+/i);
  if (m) return m[0].replace(/^lpa:/i, 'LPA:');
  throw new QrError('识别到二维码，但内容不是 eSIM 激活码（应以 LPA:1$ 开头）。');
}

export interface ImageDataLike {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** 用 jsQR 解码一帧像素（同时尝试正常与反色）。 */
export function decodeImageData(img: ImageDataLike): string | null {
  const result = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
  return result?.data ? result.data : null;
}

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: ImageBitmapSource): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorCtor {
  new (options?: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

let detectorPromise: Promise<BarcodeDetectorLike | null> | null = null;

/** 浏览器内置的二维码检测器；不支持时返回 null。 */
export function getNativeDetector(): Promise<BarcodeDetectorLike | null> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const Ctor = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
      if (!Ctor) return null;
      try {
        const formats = Ctor.getSupportedFormats ? await Ctor.getSupportedFormats() : ['qr_code'];
        if (!formats.includes('qr_code')) return null;
        return new Ctor({ formats: ['qr_code'] });
      } catch {
        return null;
      }
    })();
  }
  return detectorPromise;
}

function drawToImageData(source: CanvasImageSource, width: number, height: number, canvas?: HTMLCanvasElement): ImageDataLike {
  const c = canvas ?? document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new QrError('浏览器无法创建画布来识别图片。');
  // 透明背景的二维码图片在 jsQR 看来是黑底，先铺白色
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

/** 根据原图大小给出要尝试的缩放尺寸（最长边）。 */
export function candidateSizes(width: number, height: number): number[] {
  const longest = Math.max(width, height);
  const sizes = new Set<number>();
  sizes.add(Math.min(longest, 1600));
  if (longest > 900) sizes.add(900);
  if (longest > 1600) sizes.add(2400 > longest ? longest : 2400);
  if (longest < 500) sizes.add(longest * 2);
  return [...sizes].filter((s) => s >= 32);
}

/** 识别一张图片（拖入、选择或粘贴的文件）中的二维码，返回原始内容。 */
export async function decodeQrFromBlob(blob: Blob): Promise<string> {
  if (!blob.type.startsWith('image/')) throw new QrError('请提供图片文件（PNG、JPG、WebP 等）。');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new QrError('无法读取这张图片，格式可能不受浏览器支持。');
  }
  try {
    const detector = await getNativeDetector();
    if (detector) {
      try {
        const found = await detector.detect(bitmap);
        const hit = found.find((b) => b.rawValue);
        if (hit) return hit.rawValue;
      } catch {
        /* 退回 jsQR */
      }
    }
    for (const size of candidateSizes(bitmap.width, bitmap.height)) {
      const scale = size / Math.max(bitmap.width, bitmap.height);
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const text = decodeImageData(drawToImageData(bitmap, w, h));
      if (text) return text;
    }
    throw new QrError('图片中没有找到可识别的二维码。请尽量裁剪到只包含二维码，或换一张更清晰的图片。');
  } finally {
    bitmap.close();
  }
}

/** 识别视频当前帧；没有找到返回 null。 */
export async function decodeQrFromVideo(video: HTMLVideoElement, canvas: HTMLCanvasElement): Promise<string | null> {
  if (video.readyState < 2 || !video.videoWidth) return null;
  const detector = await getNativeDetector();
  if (detector) {
    try {
      const found = await detector.detect(video);
      const hit = found.find((b) => b.rawValue);
      return hit ? hit.rawValue : null;
    } catch {
      /* 退回 jsQR */
    }
  }
  const scale = Math.min(1, 800 / Math.max(video.videoWidth, video.videoHeight));
  return decodeImageData(drawToImageData(video, Math.round(video.videoWidth * scale), Math.round(video.videoHeight * scale), canvas));
}
