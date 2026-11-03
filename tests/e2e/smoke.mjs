// End-to-end smoke test: real Electron app + a fake OpenAI-compatible server.
// Run: npm run build && xvfb-run -a node tests/e2e/smoke.mjs   (needs a global `playwright`)
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { _electron: electron } = require('playwright')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const dataDir = path.join(root, '.e2e-data')
const shots = process.env.SHOTS_DIR ?? path.join(root, 'test-results')
fs.rmSync(dataDir, { recursive: true, force: true })
fs.mkdirSync(shots, { recursive: true })

// ---------------------------------------------------------------- fake LLM
const requests = []
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const j = JSON.parse(body || '{}')
    requests.push(j)
    const system = j.messages?.find((m) => m.role === 'system')?.content ?? ''
    const last = j.messages?.at(-1)?.content ?? ''
    let reply
    if (system.includes('记忆管理员')) {
      reply = last.includes('草莓') ? '{"ops":[{"op":"add","text":"用户喜欢吃草莓","type":"preference","importance":7}]}' : '{"ops":[]}'
    } else if (system.includes('写一篇')) {
      reply = '{"diary":"今天主人告诉我他喜欢草莓，我也想尝尝！","insights":["用户喜欢甜甜的水果"]}'
    } else if (last.includes('吃什么')) {
      reply = system.includes('草莓') ? '[love]你喜欢草莓呀，我记得的~' : '[thinking]唔……我不记得了'
    } else {
      reply = '[happy]好哒，我记住啦！'
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const chunks = reply.match(/.{1,4}/gsu) ?? []
    let i = 0
    const t = setInterval(() => {
      if (i < chunks.length) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunks[i++] } }] })}\n\n`)
      } else {
        res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 10 } })}\n\n`)
        res.write('data: [DONE]\n\n')
        res.end()
        clearInterval(t)
      }
    }, 15)
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port

fs.mkdirSync(dataDir, { recursive: true })
fs.writeFileSync(
  path.join(dataDir, 'settings.json'),
  JSON.stringify({
    providers: [{ id: 'fake', name: '测试模型', kind: 'openai', baseURL: `http://127.0.0.1:${port}/v1`, model: 'fake-1', noKey: true }],
    activeProviderId: 'fake',
    proactive: { level: 'off' }
  })
)

async function launch(openPanel) {
  const app = await electron.launch({
    executablePath: require(path.join(root, 'node_modules/electron')), // resolves (and if needed downloads) the binary
    args: ['--no-sandbox', root],
    env: { ...process.env, SOULPET_DATA_DIR: dataDir, ...(openPanel ? { SOULPET_OPEN_PANEL: openPanel } : {}) }
  })
  await app.firstWindow()
  let pet
  for (let i = 0; i < 100 && !pet; i++) {
    pet = app.windows().find((w) => w.url().includes('/pet/'))
    if (!pet) await new Promise((r) => setTimeout(r, 100))
  }
  if (!pet) throw new Error('pet window not found')
  await pet.waitForSelector('.pet')
  return { app, pet }
}

const waitFor = async (fn, ms = 8000, label = 'condition') => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const v = await fn()
    if (v) return v
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`timeout waiting for ${label}`)
}

const step = (name) => console.log(`✓ ${name}`)

// ---------------------------------------------------------------- run 1
let { app, pet } = await launch('chat')
step('app launched, pet window rendered')

// first-launch greeting bubble
await pet.waitForSelector('.bubble', { timeout: 5000 })
assert.match(await pet.textContent('.bubble'), /团子/)
step('first-launch greeting shown')
await pet.screenshot({ path: path.join(shots, 'pet-greeting.png'), omitBackground: true })

// chat with explicit "remember"
await pet.evaluate(() => window.soulpet.chatSend('记住我喜欢吃草莓'))
await waitFor(async () => (await pet.textContent('.bubble'))?.includes('记住啦'), 8000, 'reply bubble')
assert.equal(await pet.getAttribute('.pet', 'data-state'), 'happy', 'emotion tag drives the animation')
step('streamed reply shown in bubble, [happy] tag stripped and mapped to animation')
await pet.screenshot({ path: path.join(shots, 'pet-reply.png'), omitBackground: true })

const memories = await waitFor(async () => {
  const list = await pet.evaluate(() => window.soulpet.memoryList())
  return list.some((m) => m.text.includes('草莓')) && list
}, 8000, 'memory written')
assert.equal(memories.filter((m) => m.text.includes('草莓')).length, 1, 'explicit + extracted memory are de-duplicated')
step(`memory stored and de-duplicated: ${memories.map((m) => m.text).join(' | ')}`)

// recall
await new Promise((r) => setTimeout(r, 400)) // let the background extraction finish
await pet.evaluate(() => window.soulpet.chatSend('我喜欢吃什么？'))
await waitFor(async () => (await pet.textContent('.bubble'))?.includes('草莓呀'), 8000, 'recall reply')
const recallReq = requests.filter((r) => !r.messages[0].content.includes('记忆管理员')).at(-1)
assert.match(recallReq.messages[0].content, /用户喜欢吃草莓/, 'memory injected into system prompt')
assert.ok(recallReq.messages.some((m) => m.role === 'assistant' && m.content.includes('记住啦')), 'chat history included')
step('memory retrieved into the prompt and recalled')

// game
const before = (await pet.evaluate(() => window.soulpet.getSnapshot())).game
const fed = await pet.evaluate(() => window.soulpet.gameAction({ type: 'use', itemId: 'fish' }))
const after = (await pet.evaluate(() => window.soulpet.getSnapshot())).game
assert.ok(fed.ok, fed.message)
assert.equal(after.inventory.fish, before.inventory.fish - 1)
const bought = await pet.evaluate(() => window.soulpet.gameAction({ type: 'buy', itemId: 'cake' }))
assert.ok(bought.ok, bought.message)
step(`game actions work (${fed.message} / ${bought.message})`)

// diary
const diary = await pet.evaluate(() => window.soulpet.diaryGenerate())
assert.ok(diary.ok, diary.error)
step('diary generated, insight added to memory')

// panel
const panel = await waitFor(() => app.windows().find((w) => w.url().includes('panel')), 8000, 'panel window')
await panel.setViewportSize({ width: 1100, height: 760 })
await panel.waitForSelector('.chat-list .msg')
await panel.screenshot({ path: path.join(shots, 'panel-chat.png') })
for (const [label, file] of [
  ['状态', 'panel-status.png'],
  ['记忆', 'panel-memory.png'],
  ['日记', 'panel-diary.png'],
  ['形象', 'panel-appearance.png'],
  ['设置', 'panel-settings.png']
]) {
  await panel.click(`.nav:has-text("${label}")`)
  await panel.waitForTimeout(500)
  await panel.screenshot({ path: path.join(shots, file) })
}
step('panel tabs render')

// switch to the Codex-format sample pet
const packs = await pet.evaluate(() => window.soulpet.packsReload())
assert.ok(packs.some((p) => p.id === 'xiaoling' && p.kind === 'codex'), 'codex sample pack found')
await pet.evaluate(() => window.soulpet.packSelect('xiaoling'))
await pet.waitForFunction(() => getComputedStyle(document.querySelector('.pet div div') ?? document.body).backgroundImage.includes('soulpet-asset'))
const ok = await pet.evaluate(async () => {
  const el = document.querySelector('.pet div div')
  const url = getComputedStyle(el).backgroundImage.slice(5, -2)
  const img = new Image()
  img.src = url
  await img.decode()
  return img.naturalWidth === 1536 && img.naturalHeight === 1872
})
assert.ok(ok, 'spritesheet served over soulpet-asset://')
await pet.waitForTimeout(400)
await pet.screenshot({ path: path.join(shots, 'pet-codex.png'), omitBackground: true })
step('Codex-format pack renders from spritesheet')

await app.close()

// ---------------------------------------------------------------- run 2: persistence
;({ app, pet } = await launch())
const snap = await pet.evaluate(() => window.soulpet.getSnapshot())
assert.equal(snap.settings.appearance.packId, 'xiaoling')
assert.ok(snap.game.inventory.cake >= 1)
const mem2 = await pet.evaluate(() => window.soulpet.memoryList())
assert.ok(mem2.some((m) => m.text.includes('草莓')))
const hist = await pet.evaluate(() => window.soulpet.chatHistory(50))
assert.ok(hist.length >= 4)
step(`state persisted across restart (${mem2.length} memories, ${hist.length} messages)`)
await app.close()
server.close()
console.log('\nE2E OK')
