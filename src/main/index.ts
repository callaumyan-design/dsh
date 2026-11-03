import fs from 'node:fs'
import path from 'node:path'
import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  net,
  Notification,
  powerMonitor,
  shell,
  Tray,
  type MenuItemConstructorOptions
} from 'electron'
import { ITEMS } from '../core/game/items'
import { conditions } from '../core/game/engine'
import type { EventMap, Snapshot } from '../core/ipc'
import { personaFromCardFile } from '../core/persona/card'
import { DEFAULT_PERSONA, normalizePersona } from '../core/persona/persona'
import type { ProviderConfig } from '../core/ai/types'
import { AppCore, EMBEDDING_SECRET } from './core'
import { PetMotion } from './motion'
import { PackManager, registerAssetScheme } from './packs'
import { createPanelWindow, createPetWindow } from './windows'

// ------------------------------------------------------------------ paths

function resolveDataDir(): string {
  if (process.env.SOULPET_DATA_DIR) return path.resolve(process.env.SOULPET_DATA_DIR)
  // electron-builder "portable" target, or a SoulPetData folder next to the exe => portable mode
  const portableRoot = process.env.PORTABLE_EXECUTABLE_DIR ?? path.dirname(app.getPath('exe'))
  const portable = path.join(portableRoot, 'SoulPetData')
  if (process.env.PORTABLE_EXECUTABLE_DIR || (app.isPackaged && fs.existsSync(portable))) return portable
  return path.join(app.getPath('userData'), 'data')
}

const resourcesDir = app.isPackaged
  ? process.resourcesPath
  : [path.join(app.getAppPath(), 'resources'), path.join(__dirname, '../../resources')].find((d) => fs.existsSync(d)) ?? path.join(__dirname, '../../resources')

registerAssetScheme()
if (process.platform === 'linux') app.commandLine.appendSwitch('enable-transparent-visuals')

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => openPanel())
  void app.whenReady().then(main)
}

let core: AppCore
let packs: PackManager
let petWin: BrowserWindow | null = null
let panelWin: BrowserWindow | null = null
let motion: PetMotion | null = null
let tray: Tray | null = null
let quitting = false

function broadcast<K extends keyof EventMap>(channel: K, payload: EventMap[K]): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload)
}

function snapshot(): Snapshot {
  const g = core.game.data
  return {
    game: g,
    conditions: conditions(g),
    settings: core.publicSettings(),
    persona: core.persona.data,
    packs: packs.packs,
    items: ITEMS,
    usageToday: core.usageToday(),
    memoryCount: core.memory.size,
    tasks: core.tasks.data,
    platform: process.platform,
    dataDir: core.dataDir,
    version: app.getVersion()
  }
}

// ------------------------------------------------------------------ windows

function openPanel(tab?: string): void {
  if (!panelWin || panelWin.isDestroyed()) {
    panelWin = createPanelWindow(tab)
    panelWin.on('close', (e) => {
      if (!quitting) {
        e.preventDefault()
        panelWin?.hide()
      }
    })
    panelWin.once('ready-to-show', () => panelWin?.show())
  } else {
    if (tab) panelWin.webContents.send('panel:tab', { tab })
    panelWin.show()
    panelWin.focus()
  }
}

function setPetVisible(visible: boolean): void {
  if (!petWin) return
  if (visible) petWin.showInactive()
  else petWin.hide()
  motion?.setPaused('hidden', !visible)
  rebuildTray()
}

function createPet(): void {
  const s = core.settings.data
  petWin = createPetWindow(s.app.alwaysOnTop)
  motion = new PetMotion(
    petWin,
    (e) => broadcast('pet:motion', e),
    (x, y) => core.updateSettings({ window: { x, y } })
  )
  motion.placeInitial(s.window.x, s.window.y)
  motion.setPaused('disabled', !s.appearance.walkEnabled)
  if (process.platform !== 'linux') petWin.setIgnoreMouseEvents(true, { forward: true })
  petWin.once('ready-to-show', () => {
    petWin?.showInactive()
    motion?.start()
    setTimeout(() => core.greetIfNew(), 1200)
  })
  core.onChatBusy = (busy) => motion?.setPaused('chat', busy)
  core.onFocusChange = (active) => motion?.setPaused('focus', active)
  motion.setPaused('focus', core.focusActive())
}

// ------------------------------------------------------------------ menus

function petMenuTemplate(): MenuItemConstructorOptions[] {
  const g = core.game.data
  const food = ITEMS.filter((i) => (i.kind === 'food' || i.kind === 'drink' || i.kind === 'medicine' || i.kind === 'gift') && (g.inventory[i.id] ?? 0) > 0)
  const act = (type: 'play' | 'bath' | 'sleep' | 'wake' | 'work' | 'study' | 'checkIn') => () => runAction({ type })
  return [
    { label: '💬 聊天', click: () => broadcast('pet:openInput', {}) },
    {
      label: '🍙 喂食 / 使用',
      submenu: food.length
        ? food.map((i) => ({ label: `${i.emoji} ${i.name} ×${g.inventory[i.id]}`, click: () => runAction({ type: 'use', itemId: i.id }) }))
        : [{ label: '背包空了，去商店看看', click: () => openPanel('shop') }]
    },
    { label: '🎾 玩耍', click: act('play') },
    { label: '🛁 洗澡', click: act('bath') },
    g.asleep ? { label: '☀️ 叫醒', click: act('wake') } : { label: '🌙 睡觉', click: act('sleep') },
    { label: '💼 打工赚钱', click: act('work') },
    { label: '📚 学习', click: act('study') },
    { label: '📅 每日签到', click: act('checkIn') },
    core.focusActive()
      ? { label: '🍅 结束专注', click: () => core.stopFocus() }
      : {
          label: '🍅 一起专注',
          submenu: [15, 25, 45, 60].map((m) => ({ label: `${m} 分钟`, click: () => core.startFocus(m) }))
        },
    { label: '⏰ 提醒 / 待办', click: () => openPanel('tasks') },
    { type: 'separator' },
    { label: '📊 状态 / 背包', click: () => openPanel('status') },
    { label: '🧠 记忆', click: () => openPanel('memory') },
    { label: '⚙️ 设置', click: () => openPanel('settings') },
    { type: 'separator' },
    { label: '隐藏宠物', click: () => setPetVisible(false) },
    { label: '退出', click: () => app.quit() }
  ]
}

function runAction(action: Parameters<AppCore['gameAction']>[0]): void {
  const r = core.gameAction(action)
  if (r.message) broadcast('pet:say', { text: r.message, anim: r.ok ? r.anim : 'sad', emotion: r.ok ? null : 'sad', duration: 3500 })
}

function rebuildTray(): void {
  if (!tray) return
  const s = core.settings.data
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: petWin?.isVisible() ? '隐藏宠物' : '显示宠物', click: () => setPetVisible(!petWin?.isVisible()) },
      { label: '聊天', click: () => (setPetVisible(true), broadcast('pet:openInput', {})) },
      { label: '打开面板', click: () => openPanel() },
      { type: 'separator' },
      {
        label: '免打扰',
        type: 'checkbox',
        checked: s.app.dnd,
        click: (item) => {
          core.updateSettings({ app: { ...s.app, dnd: item.checked } })
          rebuildTray()
        }
      },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() }
    ])
  )
}

function createTray(): void {
  const iconFile = path.join(resourcesDir, 'icons', process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png')
  const icon = fs.existsSync(iconFile) ? nativeImage.createFromPath(iconFile) : nativeImage.createEmpty()
  tray = new Tray(icon)
  tray.setToolTip('SoulPet 灵宠')
  tray.on('click', () => setPetVisible(!petWin?.isVisible()))
  rebuildTray()
}

function applyHotkey(): void {
  globalShortcut.unregisterAll()
  const key = core.settings.data.app.hotkey
  if (!key) return
  try {
    globalShortcut.register(key, () => {
      setPetVisible(true)
      broadcast('pet:openInput', {})
    })
  } catch (e) {
    console.warn('[hotkey] cannot register', key, e)
  }
}

function applyAutoStart(): void {
  if (process.platform === 'linux' || !app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: core.settings.data.app.autoStart })
}

// ------------------------------------------------------------------ IPC

function registerIpc(): void {
  const h = ipcMain.handle.bind(ipcMain)
  h('snapshot', () => snapshot())
  h('game:action', (_e, action) => {
    const r = core.gameAction(action)
    return r
  })
  h('chat:send', (_e, text: string) => core.sendChat(String(text ?? '')))
  h('chat:abort', () => core.abortChat())
  h('chat:history', (_e, limit?: number) => core.history(limit))
  h('chat:clear', () => core.clearChat())

  h('memory:list', () => core.memory.all().map((m) => core.publicMemory(m)))
  h('memory:search', (_e, q: string) =>
    core.memory.search(String(q), { now: Date.now(), k: 20, includePinned: true, minRelevance: 0.01 }).map((r) => ({ ...r, item: core.publicMemory(r.item) }))
  )
  h('memory:add', (_e, input) => {
    const r = core.memory.add({ ...input, source: 'user' }, Date.now())
    void core.embedPending()
    return core.publicMemory(r.item)
  })
  h('memory:update', (_e, id: string, patch) => {
    const m = core.memory.update(id, patch, Date.now())
    void core.embedPending()
    return m ? core.publicMemory(m) : null
  })
  h('memory:delete', (_e, id: string) => core.memory.remove(id))
  h('memory:export', async () => {
    const r = await dialog.showSaveDialog({ title: '导出记忆', defaultPath: `soulpet-memory-${Date.now()}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (r.canceled || !r.filePath) return null
    const data = { app: 'soulpet', version: 1, exportedAt: new Date().toISOString(), persona: core.persona.data, memories: core.memory.all().map((m) => core.publicMemory(m)), diary: core.diary.data }
    fs.writeFileSync(r.filePath, JSON.stringify(data, null, 2), 'utf8')
    return r.filePath
  })
  h('memory:import', async () => {
    const r = await dialog.showOpenDialog({ title: '导入记忆', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (r.canceled || !r.filePaths[0]) return null
    const j = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'))
    const items = Array.isArray(j) ? j : Array.isArray(j?.memories) ? j.memories : []
    const res = core.memory.importItems(items, Date.now())
    void core.embedPending()
    return res
  })

  h('diary:list', () => core.diary.data)
  h('diary:generate', (_e, date?: string) => core.generateDiary(date))
  h('tasks:addReminder', (_e, input) => core.addReminder(input))
  h('tasks:addTodo', (_e, text: string) => core.addTodo(String(text ?? '')))
  h('tasks:edit', (_e, op: { kind: string; id?: string }) =>
    core.updateTasks((t) => {
      const now = Date.now()
      switch (op.kind) {
        case 'toggleTodo':
          return { ...t, todos: t.todos.map((x) => (x.id === op.id ? { ...x, done: !x.done, doneAt: x.done ? undefined : now } : x)) }
        case 'deleteTodo':
          return { ...t, todos: t.todos.filter((x) => x.id !== op.id) }
        case 'deleteReminder':
          return { ...t, reminders: t.reminders.filter((x) => x.id !== op.id) }
        case 'clearDoneTodos':
          return { ...t, todos: t.todos.filter((x) => !x.done) }
        default:
          return t
      }
    })
  )
  h('focus:start', (_e, minutes: number, label?: string) => core.startFocus(Number(minutes) || 25, label))
  h('focus:stop', () => core.stopFocus())

  h('settings:update', (_e, patch) => {
    const before = core.settings.data
    const pub = core.updateSettings(patch)
    const s = core.settings.data
    if (s.app.hotkey !== before.app.hotkey) applyHotkey()
    if (s.app.autoStart !== before.app.autoStart) applyAutoStart()
    if (s.app.alwaysOnTop !== before.app.alwaysOnTop) petWin?.setAlwaysOnTop(s.app.alwaysOnTop, 'floating')
    motion?.setPaused('disabled', !s.appearance.walkEnabled)
    if (s.app.dnd !== before.app.dnd) rebuildTray()
    return pub
  })
  h('provider:upsert', (_e, cfg: ProviderConfig) => {
    const list = core.settings.data.providers
    const exists = list.some((p) => p.id === cfg.id)
    return core.updateSettings({ providers: exists ? list.map((p) => (p.id === cfg.id ? cfg : p)) : [...list, cfg] })
  })
  h('provider:remove', (_e, id: string) => core.updateSettings({ providers: core.settings.data.providers.filter((p) => p.id !== id) }))
  h('secrets:set', (_e, target: string, key: string) => {
    core.secrets.set(target === 'embedding' ? EMBEDDING_SECRET : target, String(key ?? ''))
    const pub = core.publicSettings()
    broadcast('settings:update', pub)
    if (target === 'embedding' || target === core.settings.data.embedding.keyFrom) void core.embedPending()
    return pub
  })
  h('provider:test', (_e, id: string) => core.testProvider(id))
  h('embedding:test', async () => {
    const r = await core.testEmbedding()
    if (r.ok) void core.embedPending()
    return r
  })

  h('persona:update', (_e, patch) => {
    const p = normalizePersona({ ...core.persona.data, ...patch })
    core.persona.set(p)
    broadcast('persona:update', p)
    return p
  })
  h('persona:reset', () => {
    core.persona.set({ ...DEFAULT_PERSONA })
    broadcast('persona:update', core.persona.data)
    return core.persona.data
  })
  h('persona:importCard', async () => {
    const r = await dialog.showOpenDialog({ title: '导入角色卡', properties: ['openFile'], filters: [{ name: '角色卡', extensions: ['png', 'json'] }] })
    if (r.canceled || !r.filePaths[0]) return { ok: false }
    try {
      const patch = personaFromCardFile(new Uint8Array(fs.readFileSync(r.filePaths[0])), core.persona.data.userCallName)
      const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
      const p = normalizePersona({ ...core.persona.data, ...clean })
      core.persona.set(p)
      broadcast('persona:update', p)
      return { ok: true, persona: p }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  h('packs:reload', () => {
    const list = packs.scan()
    broadcast('packs:update', list)
    return list
  })
  h('packs:select', (_e, id: string) => core.updateSettings({ appearance: { ...core.settings.data.appearance, packId: id } }))
  h('app:openPacks', () => void shell.openPath(packs.userDir))
  h('app:openData', () => void shell.openPath(core.dataDir))
  h('app:openExternal', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
  })
  h('app:openPanel', (_e, tab?: string) => openPanel(tab))
  h('app:completeSetup', () => core.completeSetup())

  ipcMain.on('pet:dragStart', () => motion?.dragStart())
  ipcMain.on('pet:dragEnd', () => motion?.dragEnd())
  ipcMain.on('pet:interactive', (_e, on: boolean) => {
    if (process.platform === 'linux' || !petWin) return
    petWin.setIgnoreMouseEvents(!on, { forward: true })
  })
  ipcMain.on('pet:contextMenu', () => {
    if (!petWin) return
    motion?.setPaused('menu', true)
    Menu.buildFromTemplate(petMenuTemplate()).popup({ window: petWin, callback: () => motion?.setPaused('menu', false) })
  })
  ipcMain.on('pet:input', (_e, open: boolean) => {
    motion?.setPaused('input', !!open)
    if (open) petWin?.focus()
    if (open) core.lastPetInteractionAt = Date.now()
  })
  ipcMain.on('pet:size', (_e, w: number, h: number) => {
    const W = Math.round(Math.min(900, Math.max(160, w)))
    const H = Math.round(Math.min(1000, Math.max(160, h)))
    motion?.resize(W, H)
  })
}

// ------------------------------------------------------------------ main

async function main(): Promise<void> {
  if (process.platform === 'darwin') app.dock?.hide()
  core = new AppCore({
    dataDir: resolveDataDir(),
    fetch: (url, init) => net.fetch(url, init as RequestInit),
    broadcast,
    systemIdleSeconds: () => powerMonitor.getSystemIdleTime()
  })
  core.notify = (title, body) => {
    try {
      if (Notification.isSupported()) new Notification({ title, body, silent: false }).show()
    } catch (e) {
      console.warn('[notify]', e)
    }
  }
  packs = new PackManager(path.join(resourcesDir, 'pets'), path.join(core.dataDir, 'pets'))
  packs.installProtocol()
  packs.scan()
  registerIpc()
  createPet()
  createTray()
  applyHotkey()
  applyAutoStart()
  core.start()
  if (process.env.SOULPET_OPEN_PANEL) openPanel(process.env.SOULPET_OPEN_PANEL)
  else if (!core.settings.data.setupDone) openPanel('welcome')
}

app.on('before-quit', () => {
  quitting = true
  motion?.stop()
  core?.stop()
})
app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => {
  /* keep running in tray */
})
