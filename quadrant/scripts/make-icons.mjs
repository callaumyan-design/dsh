// 用 Playwright 把图标 SVG 渲染成 PWA 需要的 PNG
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

// padding: 图形距边缘的比例；bg: 背景色（maskable 需要满铺背景）
function svg({ size, padding, bg, radius }) {
  const inner = size * (1 - padding * 2);
  const off = size * padding;
  const cell = (inner - inner * 0.0625) / 2;
  const gap = inner * 0.0625;
  const r = cell * 0.27;
  const colors = ['#e0453d', '#3355e0', '#c47f00', '#8a6fd1'];
  const rects = colors
    .map((c, i) => {
      const x = off + (i % 2) * (cell + gap);
      const y = off + Math.floor(i / 2) * (cell + gap);
      return `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="${r}" fill="${c}"/>`;
    })
    .join('');
  const back = bg ? `<rect width="${size}" height="${size}" rx="${radius}" fill="${bg}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${back}${rects}</svg>`;
}

const targets = [
  { file: 'pwa-192.png', size: 192, padding: 0.14, bg: '#ffffff', radius: 42 },
  { file: 'pwa-512.png', size: 512, padding: 0.14, bg: '#ffffff', radius: 112 },
  { file: 'maskable-512.png', size: 512, padding: 0.22, bg: '#ffffff', radius: 0 },
  { file: 'apple-touch-icon.png', size: 180, padding: 0.16, bg: '#ffffff', radius: 0 },
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const t of targets) {
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${svg(t)}`);
  await page.locator('svg').screenshot({ path: path.join(root, t.file), omitBackground: true });
  console.log('wrote', t.file);
}
await browser.close();
