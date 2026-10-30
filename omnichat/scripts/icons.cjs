// Renders PNG app icons from the SVG sources with Playwright's Chromium: node scripts/icons.cjs public
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const pub = path.resolve(process.argv[2] || 'public');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  // icon.svg switches tiles with the color scheme; home-screen PNGs use the dark tile.
  await page.emulateMedia({ colorScheme: 'dark' });
  for (const [src, out, size] of [
    ['icon.svg', 'icon-192.png', 192],
    ['icon.svg', 'icon-512.png', 512],
    ['icon-maskable.svg', 'icon-maskable-512.png', 512],
  ]) {
    const svg = fs.readFileSync(path.join(pub, src), 'utf8').replace('<svg ', `<svg width="${size}" height="${size}" `);
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
    await page.screenshot({ path: path.join(pub, out), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    console.log('wrote', out);
  }
  await browser.close();
})();
