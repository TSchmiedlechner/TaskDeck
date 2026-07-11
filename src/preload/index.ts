import { contextBridge, ipcRenderer } from 'electron'
import type { Briefing, Item, Settings, TaskdeckApi } from '@shared/types'

const api: TaskdeckApi = {
  getState: () => ipcRenderer.invoke('state:get'),
  capture: (text: string) => ipcRenderer.invoke('items:capture', text),
  updateItem: (id: string, patch: Partial<Item>) => ipcRenderer.invoke('items:update', id, patch),
  completeItem: (id: string) => ipcRenderer.invoke('items:complete', id),
  deleteItem: (id: string) => ipcRenderer.invoke('items:delete', id),
  resolveSuggestion: (id: string, actionId: string, extra?: { owner?: string }) =>
    ipcRenderer.invoke('sugg:resolve', id, actionId, extra),
  getBriefing: (force: boolean) => ipcRenderer.invoke('briefing:get', force),
  acceptBriefing: (briefing: Briefing) => ipcRenderer.invoke('briefing:accept', briefing),
  getActivity: (limit: number, itemId?: string) => ipcRenderer.invoke('activity:list', limit, itemId),
  setSettings: (patch: Partial<Settings>) => ipcRenderer.invoke('settings:set', patch),
  getCostSummary: () => ipcRenderer.invoke('cost:summary'),
  setApiKey: (key: string) => ipcRenderer.invoke('apikey:set', key),
  clearApiKey: () => ipcRenderer.invoke('apikey:clear'),
  listOwners: () => ipcRenderer.invoke('owners:list'),
  openCapture: () => ipcRenderer.invoke('capture:open'),
  closeCapture: () => ipcRenderer.invoke('capture:close'),
  copyToClipboard: (text: string) => ipcRenderer.invoke('clipboard:write', text),
  onStateChanged: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('state-changed', listener)
    return () => ipcRenderer.removeListener('state-changed', listener)
  },
  onCaptureShown: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('capture-shown', listener)
    return () => ipcRenderer.removeListener('capture-shown', listener)
  }
}

contextBridge.exposeInMainWorld('taskdeck', api)
