// Generates original artwork with headless Chromium (Playwright):
//   resources/icons/icon.png, tray.png, trayTemplate.png
//   resources/pets/xiaoling/  — a Codex-format sample pet (pet.json + 8x9 spritesheet.webp)
// Usage: node scripts/gen-assets.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

// Playwright is not a project dependency; use a globally installed copy (npm i -g playwright).
const { chromium } = createRequire(import.meta.url)('playwright')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const iconsDir = path.join(root, 'resources/icons')
const petDir = path.join(root, 'resources/pets/xiaoling')
fs.mkdirSync(iconsDir, { recursive: true })
fs.mkdirSync(petDir, { recursive: true })

const blobSvg = (size, { mono = false } = {}) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="8 8 154 140" width="${size}" height="${size}">
  <defs><radialGradient id="g" cx="35%" cy="30%" r="80%"><stop offset="0%" stop-color="#c4ebff"/><stop offset="65%" stop-color="#8fd3ff"/><stop offset="100%" stop-color="#6cb6e6"/></radialGradient></defs>
  <path d="M24 134 C12 134 10 118 15 100 C22 60 50 32 85 32 C120 32 148 60 155 100 C160 118 158 134 146 134 Z" fill="${mono ? '#000' : 'url(#g)'}" stroke="${mono ? '#000' : '#4f8fbf'}" stroke-width="4"/>
  ${mono ? '<ellipse cx="64" cy="88" rx="8" ry="10" fill="#fff"/><ellipse cx="106" cy="88" rx="8" ry="10" fill="#fff"/>' : `
  <ellipse cx="58" cy="56" rx="14" ry="8" fill="#fff" opacity=".55" transform="rotate(-25 58 56)"/>
  <ellipse cx="64" cy="86" rx="7" ry="9" fill="#2b2d3a"/><circle cx="66.5" cy="82.5" r="2.8" fill="#fff"/>
  <ellipse cx="106" cy="86" rx="7" ry="9" fill="#2b2d3a"/><circle cx="108.5" cy="82.5" r="2.8" fill="#fff"/>
  <ellipse cx="50" cy="101" rx="9" ry="5" fill="#ff8fab" opacity=".5"/><ellipse cx="120" cy="101" rx="9" ry="5" fill="#ff8fab" opacity=".5"/>
  <path d="M77 102 Q85 112 93 102" stroke="#2b2d3a" stroke-width="3.5" fill="none" stroke-linecap="round"/>
  <g transform="translate(118 42) rotate(18)"><path d="M0 0 L-16 -10 L-16 10 Z" fill="#ff6f91"/><path d="M0 0 L16 -10 L16 10 Z" fill="#ff6f91"/><circle r="5" fill="#ff9bb3"/></g>`}
</svg>`

// --- Codex sample pet: drawn procedurally on a canvas inside the page -------------------
const drawPet = String.raw`
const CW = 192, CH = 208, COLS = 8
const ROWS = [['idle',6],['running-right',8],['running-left',8],['waving',4],['jumping',5],['failed',8],['waiting',6],['running',6],['review',6]]
const canvas = document.createElement('canvas')
canvas.width = CW * COLS; canvas.height = CH * ROWS.length
const ctx = canvas.getContext('2d')
const INK = '#4b3f8f', BODY = '#ece8ff', SHADE = '#cfc6ff'

function ghost(o) {
  // o: {x,y,sx,sy,rot,eyes,mouth,tail,arm,armL,blush,lookX,lookY,tear,prop,lines,dots,jumpShadow}
  ctx.save()
  ctx.translate(o.cx, o.cy)
  // shadow on ground
  ctx.save(); ctx.globalAlpha = 0.18; ctx.fillStyle = '#000'
  ctx.beginPath(); ctx.ellipse(0, 86, 46 * (o.shadow ?? 1), 7, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore()
  ctx.translate(o.x ?? 0, o.y ?? 0)
  ctx.rotate(o.rot ?? 0)
  ctx.scale(o.sx ?? 1, o.sy ?? 1)
  if (o.lines) { ctx.save(); ctx.strokeStyle = '#b9b0ee'; ctx.lineWidth = 4; ctx.lineCap = 'round'
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(-62 - i * 4, -10 + i * 18); ctx.lineTo(-74 - i * 4 - o.lines, -10 + i * 18); ctx.stroke() } ctx.restore() }
  // body: dome + wavy tail
  const t = o.tail ?? 0
  ctx.beginPath()
  ctx.moveTo(-52, 10)
  ctx.bezierCurveTo(-56, -50, -28, -78, 0, -78)
  ctx.bezierCurveTo(28, -78, 56, -50, 52, 10)
  for (let i = 0; i <= 4; i++) {
    const x = 52 - i * 26
    const wave = (i % 2 ? 1 : -1) * 6 * Math.sin(t + i)
    ctx.quadraticCurveTo(x - 13, 62 + wave, x - 26, 50 + (i % 2 ? 6 : -2))
  }
  ctx.closePath()
  const grad = ctx.createRadialGradient(-18, -40, 6, 0, -10, 90)
  grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.6, BODY); grad.addColorStop(1, SHADE)
  ctx.fillStyle = grad; ctx.fill()
  ctx.lineWidth = 4; ctx.strokeStyle = INK; ctx.stroke()
  // arms
  const arm = (side, angle) => { ctx.save(); ctx.translate(side * 50, 0); ctx.rotate(angle); ctx.beginPath(); ctx.ellipse(side * 10, 0, 14, 9, 0, 0, Math.PI * 2); ctx.fillStyle = BODY; ctx.fill(); ctx.stroke(); ctx.restore() }
  arm(-1, o.armL ?? 0.3); arm(1, o.arm ?? -0.3)
  // face
  const lx = o.lookX ?? 0, ly = o.lookY ?? 0
  ctx.fillStyle = INK; ctx.strokeStyle = INK; ctx.lineCap = 'round'
  for (const ex of [-20, 20]) {
    if (o.eyes === 'closed') { ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(ex - 8, -22); ctx.quadraticCurveTo(ex, -16, ex + 8, -22); ctx.stroke() }
    else if (o.eyes === 'happy') { ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(ex - 8, -18); ctx.quadraticCurveTo(ex, -30, ex + 8, -18); ctx.stroke() }
    else if (o.eyes === 'sad') { ctx.beginPath(); ctx.ellipse(ex + lx, -20 + ly, 6, 8, 0, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(ex - 9, -36 + (ex < 0 ? 4 : 0)); ctx.lineTo(ex + 9, -36 + (ex < 0 ? 0 : 4)); ctx.stroke() }
    else { ctx.beginPath(); ctx.ellipse(ex + lx, -20 + ly, 7, 9, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex + lx + 2.5, -24 + ly, 2.6, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = INK }
  }
  ctx.globalAlpha = 0.5; ctx.fillStyle = '#ff9cc0'
  ctx.beginPath(); ctx.ellipse(-34, -4, 8, 5, 0, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.ellipse(34, -4, 8, 5, 0, 0, Math.PI * 2); ctx.fill()
  ctx.globalAlpha = 1; ctx.fillStyle = INK; ctx.lineWidth = 3.5
  ctx.beginPath()
  if (o.mouth === 'open') { ctx.moveTo(-8, -6); ctx.quadraticCurveTo(0, 10, 8, -6); ctx.closePath(); ctx.fillStyle = '#7a2e4a'; ctx.fill() }
  else if (o.mouth === 'sad') { ctx.moveTo(-8, 2); ctx.quadraticCurveTo(0, -6, 8, 2); ctx.stroke() }
  else if (o.mouth === 'flat') { ctx.moveTo(-6, -2); ctx.lineTo(6, -2); ctx.stroke() }
  else if (o.mouth === 'o') { ctx.arc(0, -2, 4.5, 0, Math.PI * 2); ctx.fillStyle = '#7a2e4a'; ctx.fill() }
  else { ctx.moveTo(-7, -5); ctx.quadraticCurveTo(0, 3, 7, -5); ctx.stroke() }
  if (o.tear) { ctx.fillStyle = '#7ec8ff'; ctx.beginPath(); ctx.moveTo(-24, -10 + o.tear); ctx.quadraticCurveTo(-30, 0 + o.tear, -24, 4 + o.tear); ctx.quadraticCurveTo(-18, 0 + o.tear, -24, -10 + o.tear); ctx.fill() }
  if (o.prop === 'laptop') { ctx.fillStyle = '#4b5563'; ctx.fillRect(-30, 18, 60, 30); ctx.fillStyle = '#a5f3fc'; ctx.fillRect(-25, 22, 50, 22); ctx.fillStyle = '#374151'; ctx.fillRect(-38, 46, 76, 6) }
  if (o.prop === 'paper') { ctx.save(); ctx.rotate(-0.08); ctx.fillStyle = '#fff'; ctx.strokeStyle = '#a8a2cc'; ctx.lineWidth = 2; ctx.fillRect(-28, 14, 56, 40); ctx.strokeRect(-28, 14, 56, 40); ctx.strokeStyle = '#c9c4e6'; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-20, 22 + i * 8); ctx.lineTo(16 - (i % 2) * 10, 22 + i * 8); ctx.stroke() } ctx.restore() }
  ctx.restore()
  if (o.dots) { ctx.fillStyle = '#8b80c9'; for (let i = 0; i < o.dots; i++) { ctx.beginPath(); ctx.arc(o.cx + 46 + i * 12, o.cy - 92, 4, 0, Math.PI * 2); ctx.fill() } }
  if (o.sparkle) { ctx.fillStyle = '#ffd34d'; ctx.font = '22px sans-serif'; ctx.fillText('✦', o.cx + 52, o.cy - 70 + o.sparkle) }
}

function frame(row, i, n) {
  const ph = (i / n) * Math.PI * 2
  const base = { cx: 0, cy: 0, tail: ph }
  switch (ROWS[row][0]) {
    case 'idle': return { ...base, y: Math.sin(ph) * 4, sy: 1 + Math.sin(ph) * 0.02, eyes: i === 4 ? 'closed' : 'normal' }
    case 'running-right': return { ...base, x: Math.sin(ph) * 3, y: -Math.abs(Math.sin(ph)) * 10, rot: 0.14, lookX: 4, mouth: 'open', lines: 4 + (i % 2) * 6, arm: -0.9 + Math.sin(ph) * 0.5, armL: 0.9 - Math.sin(ph) * 0.5, tail: ph * 2 }
    case 'waving': return { ...base, y: Math.sin(ph) * 2, eyes: 'happy', mouth: 'open', arm: -1.6 - Math.sin(ph) * 0.6 }
    case 'jumping': { const ys = [0, -26, -44, -26, 0]; const sq = [0.9, 1.05, 1.08, 1.05, 0.9]; return { ...base, y: ys[i], sy: sq[i], sx: 2 - sq[i], eyes: i === 2 ? 'happy' : 'normal', mouth: 'open', arm: -1.2, armL: 1.2, shadow: 1 - Math.abs(ys[i]) / 90 } }
    case 'failed': return { ...base, y: 6 + Math.sin(ph) * 2, sy: 0.95, sx: 1.04, eyes: 'sad', mouth: 'sad', tear: (i % 4) * 6, arm: 0.6, armL: -0.6 }
    case 'waiting': return { ...base, y: Math.sin(ph) * 3, lookX: 4, lookY: -5, mouth: 'flat', dots: (i % 3) + 1 }
    case 'running': return { ...base, y: Math.sin(ph * 2) * 2, lookY: 4, mouth: 'flat', prop: 'laptop', arm: 0.7 + (i % 2) * 0.3, armL: -0.7 - ((i + 1) % 2) * 0.3, sparkle: (i % 3) * -4 }
    case 'review': return { ...base, y: Math.sin(ph) * 2, lookX: Math.sin(ph) * 5, lookY: 4, mouth: 'smile', prop: 'paper', arm: 0.9, armL: -0.9 }
  }
}

ROWS.forEach(([name, n], row) => {
  for (let i = 0; i < n; i++) {
    ctx.save()
    const cx = i * CW + CW / 2, cy = row * CH + 112
    ctx.beginPath(); ctx.rect(i * CW, row * CH, CW, CH); ctx.clip() // never bleed into neighbouring cells
    if (name === 'running-left') { ctx.translate(cx * 2, 0); ctx.scale(-1, 1) }
    const src = name === 'running-left' ? frame(1, i, n) : frame(row, i, n)
    ghost({ ...src, cx, cy })
    ctx.restore()
  }
})
window.__sheet = canvas.toDataURL('image/webp', 0.92)
window.__preview = (() => { const c = document.createElement('canvas'); c.width = CW; c.height = CH; c.getContext('2d').drawImage(canvas, 0, 0, CW, CH, 0, 0, CW, CH); return c.toDataURL('image/png') })()
`

const browser = await chromium.launch()
const page = await browser.newPage({ deviceScaleFactor: 1 })

async function svgToPng(svg, size, file) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`)
  await page.locator('svg').screenshot({ path: file, omitBackground: true })
}

await svgToPng(blobSvg(512), 512, path.join(iconsDir, 'icon.png'))
await svgToPng(blobSvg(32), 32, path.join(iconsDir, 'tray.png'))
await svgToPng(blobSvg(22, { mono: true }), 22, path.join(iconsDir, 'trayTemplate.png'))

await page.setContent('<html><body></body></html>')
await page.evaluate(drawPet)
const sheet = await page.evaluate(() => window.__sheet)
fs.writeFileSync(path.join(petDir, 'spritesheet.webp'), Buffer.from(sheet.split(',')[1], 'base64'))
const preview = await page.evaluate(() => window.__preview)
fs.writeFileSync(path.join(petDir, 'preview.png'), Buffer.from(preview.split(',')[1], 'base64'))
fs.writeFileSync(
  path.join(petDir, 'pet.json'),
  JSON.stringify(
    {
      id: 'xiaoling',
      displayName: '小灵（Codex 格式示例）',
      description: 'SoulPet 自带的原创小幽灵，Codex Pet 格式（8×9 精灵图，单帧 192×208），可作为自制宠物的模板。',
      author: 'SoulPet',
      license: 'CC0-1.0',
      spritesheetPath: 'spritesheet.webp',
      spriteVersionNumber: 1,
      fps: 8
    },
    null,
    2
  ) + '\n'
)
await browser.close()
console.log('assets written to resources/')
