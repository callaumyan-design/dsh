// Local-only Live2D check. Live2D Cubism Core and sample models are proprietary, so they are
// NOT in the repo and this test does not run in CI.
//
// Usage: LIVE2D_CORE=/path/live2dcubismcore.min.js LIVE2D_MODEL_DIR=/path/to/model/folder \
//        xvfb-run -a node tests/e2e/live2d-local.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { _electron: electron } = require('playwright')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const core = process.env.LIVE2D_CORE
const modelDir = process.env.LIVE2D_MODEL_DIR
if (!core || !modelDir) {
  console.log('skip: set LIVE2D_CORE and LIVE2D_MODEL_DIR')
  process.exit(0)
}
const dataDir = path.join(root, '.e2e-live2d')
const shots = process.env.SHOTS_DIR ?? path.join(root, 'test-results')
fs.rmSync(dataDir, { recursive: true, force: true })
fs.mkdirSync(path.join(dataDir, 'pets'), { recursive: true })
fs.mkdirSync(shots, { recursive: true })
fs.cpSync(modelDir, path.join(dataDir, 'pets', 'live2d-sample'), { recursive: true })
fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ setupDone: true, onboarded: true, proactive: { level: 'off' }, appearance: { walkEnabled: false } }))

const app = await electron.launch({
  executablePath: require(path.join(root, 'node_modules/electron')),
  args: ['--no-sandbox', root],
  env: { ...process.env, SOULPET_DATA_DIR: dataDir }
})
await app.firstWindow()
let pet
for (let i = 0; i < 100 && !pet; i++) {
  pet = app.windows().find((w) => w.url().includes('/pet/'))
  if (!pet) await new Promise((r) => setTimeout(r, 100))
}
await pet.waitForSelector('.pet')
const packs = await pet.evaluate(() => window.soulpet.packsReload())
const l2d = packs.find((p) => p.kind === 'live2d')
assert.ok(l2d, 'live2d pack auto-detected from *.model3.json')
console.log('✓ detected', l2d.name, l2d.live2d.model)
await pet.evaluate((id) => window.soulpet.packSelect(id), l2d.id)
await pet.waitForSelector('.l2d-missing') // no core yet -> friendly placeholder
console.log('✓ placeholder shown without Cubism Core')
const r = await pet.evaluate((file) => window.soulpet.live2dInstallCore(file), core)
assert.ok(r.ok, r.error)
await pet.waitForSelector('[data-live2d="ready"]', { timeout: 30000 })
await pet.waitForTimeout(1500)
await pet.screenshot({ path: path.join(shots, 'pet-live2d.png'), omitBackground: true })
const painted = await pet.evaluate(() => {
  const c = document.querySelector('[data-live2d] canvas')
  return !!c && c.width > 0
})
assert.ok(painted)
console.log('✓ model rendered (screenshot: test-results/pet-live2d.png)')
await pet.evaluate(() => window.soulpet.gameAction({ type: 'pet' })) // happy -> reaction motion
await pet.waitForTimeout(1200)
await pet.screenshot({ path: path.join(shots, 'pet-live2d-happy.png'), omitBackground: true })
await app.close()
console.log('LIVE2D OK')
