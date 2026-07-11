import { contextBridge, ipcRenderer } from 'electron'
import type { Briefing, DeviceCodePrompt, Item, Settings, TaskdeckApi } from '@shared/types'

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
  setHotkey: (accelerator: string) => ipcRenderer.invoke('hotkey:set', accelerator),
  outlookSignIn: () => ipcRenderer.invoke('outlook:signin'),
  outlookSignOut: () => ipcRenderer.invoke('outlook:signout'),
  syncNow: () => ipcRenderer.invoke('sync:now'),
  setConnectorToken: (connector: 'github' | 'jira', token: string) =>
    ipcRenderer.invoke('connector:setToken', connector, token),
  clearConnectorToken: (connector: 'github' | 'jira') => ipcRenderer.invoke('connector:clearToken', connector),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
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
  },
  onShowBriefing: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('show-briefing', listener)
    return () => ipcRenderer.removeListener('show-briefing', listener)
  },
  onDeviceCode: (cb: (prompt: DeviceCodePrompt) => void) => {
    const listener = (_e: unknown, prompt: DeviceCodePrompt): void => cb(prompt)
    ipcRenderer.on('outlook-devicecode', listener)
    return () => ipcRenderer.removeListener('outlook-devicecode', listener)
  }
}

contextBridge.exposeInMainWorld('taskdeck', api)
