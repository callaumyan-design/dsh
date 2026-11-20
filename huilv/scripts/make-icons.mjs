// 生成图标：两枚交叠的圆（两种货币），交叠处颜色更深。用 Playwright 把 SVG 渲染成 PWA 需要的 PNG。
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

function mark(size, padding) {
  const inner = size * (1 - padding * 2);
  const r = inner * 0.3;
  const cy = size / 2;
  const dx = r * 0.62;
  const a = size / 2 - dx;
  const b = size / 2 + dx;
  return `<defs><clipPath id="c"><circle cx="${a}" cy="${cy}" r="${r}"/></clipPath></defs>` +
    `<circle cx="${b}" cy="${cy}" r="${r}" fill="#f0b43c"/>` +
    `<circle cx="${a}" cy="${cy}" r="${r}" fill="#2b50d8"/>` +
    `<circle cx="${b}" cy="${cy}" r="${r}" fill="#16287a" clip-path="url(#c)"/>`;
}

function svg({ size, padding, bg, radius }) {
  const back = bg ? `<rect width="${size}" height="${size}" rx="${radius}" fill="${bg}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${back}${mark(size, padding)}</svg>`;
}

writeFileSync(path.join(root, 'favicon.svg'), svg({ size: 32, padding: 0.02, bg: null, radius: 0 }).replace(/ width="32" height="32"/, ''));

const targets = [
  { file: 'pwa-192.png', size: 192, padding: 0.12, bg: '#ffffff', radius: 42 },
  { file: 'pwa-512.png', size: 512, padding: 0.12, bg: '#ffffff', radius: 112 },
  { file: 'maskable-512.png', size: 512, padding: 0.2, bg: '#ffffff', radius: 0 },
  { file: 'apple-touch-icon.png', size: 180, padding: 0.14, bg: '#ffffff', radius: 0 },
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
