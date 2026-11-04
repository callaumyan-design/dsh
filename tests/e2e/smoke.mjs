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
const sttRequests = []
const imageRequests = []
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    if (req.url.endsWith('/images/generations')) {
      imageRequests.push(JSON.parse(body))
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ data: [{ b64_json: fs.readFileSync(path.join(root, 'resources/icons/icon.png')).toString('base64') }] }))
    }
    if (req.url.endsWith('/audio/transcriptions')) {
      sttRequests.push({ type: req.headers['content-type'], size: body.length })
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ text: '<|zh|>我喜欢吃什么' }))
    }
    const j = JSON.parse(body || '{}')
    requests.push(j)
    const system = j.messages?.find((m) => m.role === 'system')?.content ?? ''
    const last = j.messages?.at(-1)?.content ?? ''
    let reply
    if (system.includes('整理它的长期记忆')) {
      const ids = [...last.matchAll(/- (m_[a-z0-9]+)（/g)].map((m) => m[1])
      reply = JSON.stringify({ merges: [{ ids, text: '用户非常喜欢吃草莓', importance: 8 }] })
    } else if (system.includes('记忆管理员')) {
      reply = last.includes('草莓') ? '{"ops":[{"op":"add","text":"用户喜欢吃草莓","type":"preference","importance":7}]}' : '{"ops":[]}'
    } else if (system.includes('写一篇')) {
      reply = '{"diary":"今天主人告诉我他喜欢草莓，我也想尝尝！","insights":["用户喜欢甜甜的水果"]}'
    } else if (last.includes('提醒我')) {
      reply = '[happy]好哒，到时候叫你~[[remind|+20m|喝水]]'
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
    proactive: { level: 'off' },
    stt: { enabled: true, baseURL: `http://127.0.0.1:${port}/v1`, model: 'sv', keyFrom: 'own' },
    imageGen: { baseURL: `http://127.0.0.1:${port}/v1`, model: 'kolors', size: '1024x1024', keyFrom: 'own', transparent: false }
  })
)

async function launch(openPanel) {
  const app = await electron.launch({
    executablePath: require(path.join(root, 'node_modules/electron')), // resolves (and if needed downloads) the binary
    args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', root],
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
let { app, pet } = await launch()
step('app launched, pet window rendered')
if (process.platform === 'win32') {
  // the PowerShell foreground-window probe must compile and report within a few seconds
  const d = await waitFor(async () => {
    const x = await pet.evaluate(() => window.soulpet.diagnostics())
    return x.fullscreenLastProbeAt ? x : null
  }, 30000, 'fullscreen probe output')
  assert.equal(d.fullscreenWatcher, 'running')
  assert.match(String(d.fullscreenLastProbe), /-?\d+,-?\d+,-?\d+,-?\d+,/)
  step(`fullscreen watcher running on Windows (${d.fullscreenLastProbe})`)
}

// first run: setup wizard opens in the panel
const wizard = await waitFor(() => app.windows().find((w) => w.url().includes('panel')), 8000, 'setup wizard')
await wizard.setViewportSize({ width: 1100, height: 760 })
await wizard.waitForSelector('.welcome')
await wizard.screenshot({ path: path.join(shots, 'wizard-1.png') })
await wizard.fill('.welcome input >> nth=0', '小团')
await wizard.fill('.welcome input >> nth=1', '小明')
await wizard.click('button:has-text("下一步")')
await wizard.waitForSelector('.provider-cards')
await wizard.waitForSelector('text=已配置') // fake provider needs no key
await wizard.screenshot({ path: path.join(shots, 'wizard-2.png') })
await wizard.click('button:has-text("下一步")')
await wizard.waitForSelector('.pack-grid')
await wizard.click('button:has-text("下一步")')
await wizard.click('button:has-text("开始陪伴")')
await waitFor(async () => (await pet.textContent('.bubble'))?.includes('小团'), 8000, 'greeting with new name')
const persona = (await pet.evaluate(() => window.soulpet.getSnapshot())).persona
assert.equal(persona.name, '小团')
assert.equal(persona.userCallName, '小明')
step('setup wizard: pet named, provider confirmed, greeting uses the new name')
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
  assert.match(recallReq.messages[0].content, /小团/, 'persona name in system prompt')
assert.ok(recallReq.messages.some((m) => m.role === 'assistant' && m.content.includes('记住啦')), 'chat history included')
step('memory retrieved into the prompt and recalled')

// reminders from chat (action tags) + firing + focus
await pet.evaluate(() => window.soulpet.chatSend('20分钟后提醒我喝水'))
await waitFor(async () => (await pet.textContent('.bubble'))?.includes('已设提醒'), 8000, 'reminder confirmation')
assert.ok(!(await pet.textContent('.bubble')).includes('[['), 'action tag hidden from the bubble')
let tasks = (await pet.evaluate(() => window.soulpet.getSnapshot())).tasks
assert.ok(tasks.reminders.some((r) => r.text === '喝水' && r.source === 'ai' && r.dueAt > Date.now() + 19 * 60_000))
step('AI created a reminder via [[remind]] tag; tag hidden in the bubble')
await pet.evaluate(() => window.soulpet.tasksAddReminder({ text: '伸个懒腰', dueAt: Date.now() + 500 }))
await waitFor(async () => (await pet.textContent('.bubble'))?.includes('伸个懒腰'), 25000, 'reminder fired')
tasks = (await pet.evaluate(() => window.soulpet.getSnapshot())).tasks
assert.ok(tasks.reminders.find((r) => r.text === '伸个懒腰')?.done)
step('due reminder fired as a pet bubble')
await pet.evaluate(() => window.soulpet.focusStart(25))
await pet.waitForSelector('.pet[data-state="work"]')
await pet.waitForTimeout(3600) // let the start bubble expire so the timer badge shows
await pet.waitForSelector('.focus-badge')
await pet.screenshot({ path: path.join(shots, 'pet-focus.png'), omitBackground: true })
await pet.evaluate(() => window.soulpet.focusStop())
assert.equal((await pet.evaluate(() => window.soulpet.getSnapshot())).tasks.focus, null)
step('focus mode: work animation + countdown badge, stop works')

// voice input: hold the mic button (fake microphone), release -> transcribe -> chat
const sttBefore = requests.length
// open the quick input the same way the hotkey does
await app.evaluate(({ BrowserWindow }) => {
  for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().includes('/pet/')) w.webContents.send('pet:openInput', {})
})
await pet.waitForSelector('.quick-input .mic')
const mic = await pet.$('.quick-input .mic')
const box = await mic.boundingBox()
await pet.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await pet.mouse.down()
await pet.waitForSelector('.quick-input .mic.on')
await pet.waitForTimeout(1200)
await pet.mouse.up()
await waitFor(() => sttRequests.length > 0, 8000, 'transcription request')
assert.match(sttRequests[0].type, /multipart\/form-data/)
assert.ok(sttRequests[0].size > 1000, `recorded audio should not be empty (${sttRequests[0].size} bytes)`)
await waitFor(() => requests.slice(sttBefore).some((r) => r.messages?.at(-1)?.content === '我喜欢吃什么'), 8000, 'transcript sent as chat')
await waitFor(async () => (await pet.textContent('.bubble'))?.includes('草莓呀'), 8000, 'reply to voice message')
step(`voice input: recorded ${sttRequests[0].size} bytes from the (fake) mic, transcribed and answered`)

// right-click: a tiny two-button menu (🎤 | ⌨), not a long native menu
await pet.click('.pet', { button: 'right' })
await pet.waitForSelector('.mini')
assert.equal((await pet.$$('.mini .mini-btn')).length, 2, 'small menu has exactly two buttons')
await pet.screenshot({ path: path.join(shots, 'pet-menu.png'), omitBackground: true })
await pet.click('.mini .mini-btn:nth-child(2)')
await pet.waitForSelector('.quick-input input')
assert.equal(await pet.evaluate(() => !document.querySelector('.mini')), true, 'menu closes when typing starts')
await pet.waitForFunction(() => document.activeElement?.matches('.quick-input input'), null, { timeout: 3000 })
await pet.keyboard.press('Escape')
await pet.waitForSelector('.quick-input', { state: 'detached' })
await pet.click('.pet', { button: 'right' })
await pet.waitForSelector('.mini')
await pet.keyboard.press('Escape')
await pet.waitForSelector('.mini', { state: 'detached' })
step('right-click shows a two-button menu; ⌨ opens the text box; Esc closes both')

// 🎤 in the menu: a quick tap starts listening, ■ sends
const sttCount = sttRequests.length
const chatsBefore = requests.length
await pet.click('.pet', { button: 'right' })
await pet.waitForSelector('.mini')
await pet.click('.mini .mini-btn:nth-child(1)')
await pet.waitForSelector('.mini .mini-btn.rec')
await waitFor(async () => (await pet.textContent('.mini'))?.includes('正在听'), 5000, 'listening pill')
await pet.waitForTimeout(1200)
await pet.screenshot({ path: path.join(shots, 'pet-listening.png'), omitBackground: true })
await pet.click('.mini .mini-btn.rec')
await waitFor(() => sttRequests.length > sttCount, 8000, 'transcription from the menu mic')
await waitFor(() => requests.slice(chatsBefore).some((r) => r.messages?.at(-1)?.content === '我喜欢吃什么'), 8000, 'menu voice sent as chat')
await pet.waitForSelector('.mini', { state: 'detached' })
step('menu 🎤: tap to start listening, ■ to stop → transcribed and sent')

// game
const before = (await pet.evaluate(() => window.soulpet.getSnapshot())).game
const fed = await pet.evaluate(() => window.soulpet.gameAction({ type: 'use', itemId: 'fish' }))
const after = (await pet.evaluate(() => window.soulpet.getSnapshot())).game
assert.ok(fed.ok, fed.message)
assert.equal(after.inventory.fish, before.inventory.fish - 1)
const bought = await pet.evaluate(() => window.soulpet.gameAction({ type: 'buy', itemId: 'cake' }))
assert.ok(bought.ok, bought.message)
await waitFor(async () => (await pet.evaluate(() => window.soulpet.getSnapshot())).game.achievements?.first_meal, 5000, 'achievement unlocked')
step(`game actions work (${fed.message} / ${bought.message}); achievement "第一口饭" unlocked`)

// diary
const diary = await pet.evaluate(() => window.soulpet.diaryGenerate())
assert.ok(diary.ok, diary.error)
step('diary generated, insight added to memory')

// memory consolidation ("dream")
await pet.evaluate(() => window.soulpet.memoryAdd({ text: '用户超级喜欢吃草莓', type: 'preference', importance: 6 }))
const beforeDream = await pet.evaluate(() => window.soulpet.memoryList())
const dream = await pet.evaluate(() => window.soulpet.memoryConsolidate())
assert.ok(dream.ok && dream.merged === 1, JSON.stringify(dream))
const afterDream = await pet.evaluate(() => window.soulpet.memoryList())
assert.equal(afterDream.length, beforeDream.length - 1)
assert.ok(afterDream.some((m) => m.text === '用户非常喜欢吃草莓'))
step('memory consolidation merged two similar memories')

// panel
const panel = wizard
await panel.waitForSelector('.chat-list .msg')
await panel.screenshot({ path: path.join(shots, 'panel-chat.png') })
for (const [label, file] of [
  ['状态', 'panel-status.png'],
  ['记忆', 'panel-memory.png'],
  ['日记', 'panel-diary.png'],
  ['提醒', 'panel-tasks.png'],
  ['形象', 'panel-appearance.png'],
  ['设置', 'panel-settings.png']
]) {
  await panel.click(`.nav:has-text("${label}")`)
  await panel.waitForTimeout(500)
  await panel.screenshot({ path: path.join(shots, file) })
}
step('panel tabs render')

// AI avatar: describe -> generate -> cut out -> save as a pet (through the panel UI)
await panel.click('.nav:has-text("形象")')
await panel.fill('.avatar-form textarea', '一只戴围巾的小企鹅')
await panel.click('.avatar-form button:has-text("生成")')
await panel.waitForSelector('.avatar-preview img')
assert.match(imageRequests[0].prompt, /小企鹅.*纯白色背景/)
await panel.fill('.avatar-form input[placeholder="给新形象起个名字"]', '企鹅君')
await panel.click('.avatar-form button:has-text("就用它")')
await waitFor(async () => (await pet.evaluate(() => window.soulpet.getSnapshot())).packs.some((p) => p.name === '企鹅君' && p.procedural), 8000, 'AI avatar pack')
await pet.waitForSelector('.pet .proc img')
await panel.screenshot({ path: path.join(shots, 'panel-avatar.png') })
step('AI avatar generated, background removed and saved as an animated pet')

// one-image pet: any picture becomes a procedurally animated pet
const img = await pet.evaluate((file) => window.soulpet.packImport('image', file), path.join(root, 'resources/icons/icon.png'))
assert.ok(img.ok, img.error)
await pet.waitForSelector('.pet .proc.state-idle img')
await pet.evaluate(() => window.soulpet.gameAction({ type: 'pet' }))
await pet.waitForTimeout(700)
await pet.screenshot({ path: path.join(shots, 'pet-image.png'), omitBackground: true })
step(`one-image pet "${img.name}" created and animated procedurally`)

// Live2D pack without the (proprietary, user-supplied) Cubism Core: detected + friendly placeholder
fs.mkdirSync(path.join(dataDir, 'pets', 'l2d-test', 'runtime'), { recursive: true })
fs.writeFileSync(path.join(dataDir, 'pets', 'l2d-test', 'runtime', 'test.model3.json'), JSON.stringify({ Version: 3, FileReferences: { Moc: 'test.moc3', Textures: [] } }))
const l2dPacks = await pet.evaluate(() => window.soulpet.packsReload())
const l2d = l2dPacks.find((p) => p.kind === 'live2d')
assert.ok(l2d, 'live2d pack auto-detected')
await pet.evaluate((id) => window.soulpet.packSelect(id), l2d.id)
await pet.waitForSelector('.pet .l2d-missing')
step('Live2D pack auto-detected; placeholder asks for the Cubism Core')

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

// idle resource usage (informational; software rendering under Xvfb inflates CPU)
await app.evaluate(({ app }) => app.getAppMetrics()) // first call primes the counters
await pet.waitForTimeout(8000)
const metrics = await app.evaluate(({ app }) => app.getAppMetrics().map((m) => ({ type: m.type, cpu: m.cpu.percentCPUUsage, mem: m.memory.workingSetSize })))
const cpu = metrics.reduce((s, m) => s + m.cpu, 0)
const memMb = metrics.reduce((s, m) => s + m.mem, 0) / 1024
step(`idle usage: ${cpu.toFixed(1)}% CPU, ${memMb.toFixed(0)} MB across ${metrics.length} processes (${metrics.map((m) => `${m.type} ${m.cpu.toFixed(1)}% ${(m.mem / 1024).toFixed(0)}MB`).join(", ")})`)
await app.close()
server.close()
console.log('\nE2E OK')
