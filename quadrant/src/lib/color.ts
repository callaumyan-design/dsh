import type { QuadrantId } from './types';

/** 自定义象限颜色：只存一个基础色，其余派生 */
export type QuadrantColors = Partial<Record<QuadrantId, string>>;

/** 默认配色（与 app.css 中经过色盲校验的值一致） */
export const DEFAULT_COLORS: Record<QuadrantId, string> = {
  q1: '#e0453d',
  q2: '#3355e0',
  q3: '#c47f00',
  q4: '#8a6fd1',
};

export interface Palette {
  id: string;
  name: string;
  colors: Record<QuadrantId, string>;
}

export const PALETTES: Palette[] = [
  { id: 'default', name: '默认', colors: DEFAULT_COLORS },
  { id: 'traffic', name: '红绿灯', colors: { q1: '#e0453d', q2: '#1f9d63', q3: '#e09a14', q4: '#8b93a5' } },
  { id: 'soft', name: '柔和', colors: { q1: '#e2725b', q2: '#4f86e8', q3: '#d9a23a', q4: '#9b7fd1' } },
  { id: 'morandi', name: '莫兰迪', colors: { q1: '#b5655d', q2: '#5f7f9a', q3: '#b08d57', q4: '#8a7f9e' } },
  { id: 'cool', name: '冷色', colors: { q1: '#d6336c', q2: '#1c7ed6', q3: '#0ca678', q4: '#7048e8' } },
];

const HEX = /^#[0-9a-f]{6}$/i;

export function isHex(v: unknown): v is string {
  return typeof v === 'string' && HEX.test(v);
}

type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map((x) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0')).join('');
}

/** 在 a 与 b 之间按 t（0=a，1=b）线性混合 */
export function mix(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
}

function channel(c: number) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** 向 toward（黑或白）逐步靠近，直到与 against 的对比度达到 min */
function pushContrast(base: string, toward: string, against: string, min: number): string {
  let c = base;
  for (let t = 0.04; contrast(c, against) < min && t <= 1; t += 0.04) c = mix(base, toward, t);
  return c;
}

function toOklab(hex: string): RGB {
  const [r, g, b] = hexToRgb(hex).map(channel) as RGB;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab 色差（×100），小于 ~10 时两种颜色很难分辨 */
export function deltaE(a: string, b: string): number {
  const A = toOklab(a);
  const B = toOklab(b);
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]) * 100;
}

export interface QuadrantTokens {
  main: string;
  soft: string;
  line: string;
  ink: string;
  btn: string;
}

const LIGHT_SURFACE = '#ffffff';
const DARK_SURFACE = '#171b24';

/** 从一个基础色派生出某个主题下需要的全部颜色，并保证文字可读 */
export function deriveTokens(base: string, mode: 'light' | 'dark'): QuadrantTokens {
  if (mode === 'light') {
    const main = pushContrast(base, '#000000', LIGHT_SURFACE, 1.8);
    const soft = mix(LIGHT_SURFACE, base, 0.08);
    return {
      main,
      soft,
      line: mix(LIGHT_SURFACE, base, 0.25),
      ink: pushContrast(base, '#000000', soft, 4.5),
      btn: pushContrast(base, '#000000', '#ffffff', 4.5),
    };
  }
  const main = pushContrast(base, '#ffffff', DARK_SURFACE, 3);
  const soft = mix(DARK_SURFACE, base, 0.09);
  return {
    main,
    soft,
    line: mix(DARK_SURFACE, base, 0.28),
    ink: pushContrast(base, '#ffffff', soft, 4.5),
    btn: pushContrast(base, '#000000', '#ffffff', 4.5),
  };
}

export function effectiveColors(custom: QuadrantColors | undefined): Record<QuadrantId, string> {
  return { ...DEFAULT_COLORS, ...(custom ?? {}) };
}

/** 生成覆盖默认配色的样式表；只为自定义过的象限输出 */
export function buildColorCss(custom: QuadrantColors | undefined): string {
  const ids = (Object.keys(custom ?? {}) as QuadrantId[]).filter((q) => isHex(custom?.[q]));
  if (!ids.length) return '';
  const block = (mode: 'light' | 'dark') =>
    ids
      .map((q) => {
        const t = deriveTokens(custom![q]!, mode);
        return `--${q}:${t.main};--${q}-soft:${t.soft};--${q}-line:${t.line};--${q}-ink:${t.ink};--${q}-btn:${t.btn};`;
      })
      .join('');
  const light = block('light');
  const dark = block('dark');
  // :root:root 提高优先级，确保覆盖 app.css 中同结构的主题规则
  return [
    `:root:root{${light}}`,
    `@media (prefers-color-scheme: dark){:root:root:not([data-theme='light']){${dark}}}`,
    `:root:root[data-theme='dark']{${dark}}`,
  ].join('\n');
}

/** 找出颜色过于接近的象限组合 */
export function similarPairs(colors: Record<QuadrantId, string>, threshold = 10): [QuadrantId, QuadrantId][] {
  const ids = Object.keys(colors) as QuadrantId[];
  const out: [QuadrantId, QuadrantId][] = [];
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) if (deltaE(colors[ids[i]], colors[ids[j]]) < threshold) out.push([ids[i], ids[j]]);
  return out;
}

export function sanitizeColors(v: unknown): QuadrantColors {
  if (!v || typeof v !== 'object') return {};
  const o = v as Record<string, unknown>;
  const out: QuadrantColors = {};
  for (const q of ['q1', 'q2', 'q3', 'q4'] as QuadrantId[]) if (isHex(o[q])) out[q] = (o[q] as string).toLowerCase();
  return out;
}
