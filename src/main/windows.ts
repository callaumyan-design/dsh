import path from 'node:path'
import { BrowserWindow, shell } from 'electron'

const preload = path.join(__dirname, '../preload/index.js')

function load(win: BrowserWindow, page: 'pet' | 'panel', query = ''): void {
  const dev = process.env.ELECTRON_RENDERER_URL
  if (dev) void win.loadURL(`${dev}/${page}/index.html${query}`)
  else void win.loadFile(path.join(__dirname, `../renderer/${page}/index.html`), { search: query.replace(/^\?/, '') })
}

function hardenNavigation(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:') && !url.startsWith(process.env.ELECTRON_RENDERER_URL ?? '\0')) e.preventDefault()
  })
}

export function createPetWindow(alwaysOnTop: boolean): BrowserWindow {
  const win = new BrowserWindow({
    width: 260,
    height: 330,
    transparent: true,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop,
    show: false,
    backgroundColor: '#00000000',
    title: 'SoulPet',
    webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  })
  if (alwaysOnTop) win.setAlwaysOnTop(true, 'floating')
  if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  hardenNavigation(win)
  load(win, 'pet')
  return win
}

export function createPanelWindow(tab?: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 980,
    height: 700,
    minWidth: 720,
    minHeight: 520,
    show: false,
    title: 'SoulPet 灵宠',
    backgroundColor: '#f7f7fb',
    autoHideMenuBar: true,
    webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  hardenNavigation(win)
  load(win, 'panel', tab ? `?tab=${encodeURIComponent(tab)}` : '')
  return win
}
