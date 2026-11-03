import { contextBridge, ipcRenderer } from 'electron'
import type { EventMap, SoulPetAPI } from '../core/ipc'

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

const api: SoulPetAPI = {
  getSnapshot: () => invoke('snapshot'),
  gameAction: (action) => invoke('game:action', action),
  chatSend: (text) => invoke('chat:send', text),
  chatAbort: () => invoke('chat:abort'),
  chatHistory: (limit) => invoke('chat:history', limit),
  chatClear: () => invoke('chat:clear'),

  memoryList: () => invoke('memory:list'),
  memorySearch: (q) => invoke('memory:search', q),
  memoryAdd: (input) => invoke('memory:add', input),
  memoryUpdate: (id, patch) => invoke('memory:update', id, patch),
  memoryDelete: (id) => invoke('memory:delete', id),
  memoryExport: () => invoke('memory:export'),
  memoryImport: () => invoke('memory:import'),
  memoryConsolidate: () => invoke('memory:consolidate'),

  diaryList: () => invoke('diary:list'),
  diaryGenerate: (date) => invoke('diary:generate', date),
  tasksAddReminder: (input) => invoke('tasks:addReminder', input),
  tasksAddTodo: (text) => invoke('tasks:addTodo', text),
  tasksEdit: (op) => invoke('tasks:edit', op),
  focusStart: (minutes, label) => invoke('focus:start', minutes, label),
  focusStop: () => invoke('focus:stop'),

  settingsUpdate: (patch) => invoke('settings:update', patch),
  providerUpsert: (cfg) => invoke('provider:upsert', cfg),
  providerRemove: (id) => invoke('provider:remove', id),
  setApiKey: (target, key) => invoke('secrets:set', target, key),
  testProvider: (id) => invoke('provider:test', id),
  testEmbedding: () => invoke('embedding:test'),

  personaUpdate: (patch) => invoke('persona:update', patch),
  personaImportCard: () => invoke('persona:importCard'),
  personaReset: () => invoke('persona:reset'),

  packsReload: () => invoke('packs:reload'),
  packSelect: (id) => invoke('packs:select', id),
  packImport: (kind) => invoke('packs:import', kind),
  openPacksFolder: () => invoke('app:openPacks'),
  openDataFolder: () => invoke('app:openData'),
  openExternal: (url) => invoke('app:openExternal', url),

  openPanel: (tab) => invoke('app:openPanel', tab),
  completeSetup: () => invoke('app:completeSetup'),
  petDragStart: () => ipcRenderer.send('pet:dragStart'),
  petDragEnd: () => ipcRenderer.send('pet:dragEnd'),
  petSetInteractive: (on) => ipcRenderer.send('pet:interactive', on),
  petContextMenu: () => ipcRenderer.send('pet:contextMenu'),
  petInputState: (open) => ipcRenderer.send('pet:input', open),
  petSetSize: (w, h) => ipcRenderer.send('pet:size', w, h),

  on<K extends keyof EventMap>(channel: K, cb: (payload: EventMap[K]) => void) {
    const listener = (_e: Electron.IpcRendererEvent, payload: EventMap[K]) => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('soulpet', api)
