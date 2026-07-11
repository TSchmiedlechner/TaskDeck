import { clipboard, ipcMain } from 'electron'
import type { Store } from './store'
import type { Brain } from './brain'
import type { Scheduler } from './scheduler'
import { nextMonday } from './logic'
import { clearApiKey, setApiKey } from './keystore'
import type { Briefing, DeckState, Item, Settings, StructureProposal } from '@shared/types'

export interface IpcDeps {
  store: Store
  brain: Brain
  scheduler: Scheduler
  broadcast: () => void
  openCapture: () => void
  closeCapture: () => void
  applyPrivacyMode: (on: boolean) => void
}

export function registerIpc(deps: IpcDeps): void {
  const { store, brain, scheduler, broadcast, openCapture, closeCapture, applyPrivacyMode } = deps

  const notifyAndScan = (): void => {
    scheduler.onMutation()
    broadcast()
  }

  ipcMain.handle('state:get', (): DeckState => {
    return {
      items: store.listItems(),
      suggestions: store.listPendingSuggestions(),
      settings: store.getSettings(),
      brainStatus: brain.status,
      brainProvider: brain.providerId,
      keySource: brain.keySource,
      cliAvailable: brain.cliAvailable,
      pendingTriageCount: scheduler.pendingTriageCount()
    }
  })

  ipcMain.handle('items:capture', (_e, text: string) => {
    const trimmed = String(text ?? '').trim()
    if (!trimmed) return
    const item = store.createCapture(trimmed)
    store.logActivity(item.id, 'you', 'Captured')
    notifyAndScan()
  })

  ipcMain.handle('items:update', (_e, id: string, patch: Partial<Item>) => {
    store.updateItem(id, patch)
    store.logActivity(id, 'you', describePatch(patch))
    notifyAndScan()
  })

  ipcMain.handle('items:complete', (_e, id: string) => {
    const item = store.getItem(id)
    if (!item) return
    store.updateItem(id, { completedAt: new Date().toISOString(), bucket: 'done' })
    store.logActivity(id, 'you', `Completed "${item.title}"`)
    notifyAndScan()
  })

  ipcMain.handle('items:delete', (_e, id: string) => {
    const item = store.getItem(id)
    if (item) store.logActivity(id, 'you', `Deleted "${item.title}"`)
    store.deleteItem(id)
    notifyAndScan()
  })

  ipcMain.handle('sugg:resolve', (_e, id: string, actionId: string, extra?: { owner?: string }) => {
    applySuggestionAction(deps, id, actionId, extra)
    notifyAndScan()
  })

  ipcMain.handle('briefing:get', async (_e, force: boolean): Promise<Briefing> => {
    const date = new Date().toISOString().slice(0, 10)
    const cacheKey = `briefing:${date}`
    if (!force) {
      const cached = store.getKv(cacheKey)
      if (cached) return JSON.parse(cached)
    }
    const briefing = await brain.composeBriefing(store.listItems(), store.getSettings())
    store.setKv(cacheKey, JSON.stringify(briefing))
    store.logActivity(null, 'agent', `Morning briefing generated (${briefing.generatedBy})`)
    broadcast()
    return briefing
  })

  ipcMain.handle('briefing:accept', (_e, briefing: Briefing) => {
    const proposedIds = new Set(briefing.proposedNow.map((p) => p.itemId))
    for (const pick of briefing.proposedNow) {
      const item = store.getItem(pick.itemId)
      if (!item || item.completedAt) continue
      if (item.bucket !== 'now') {
        store.updateItem(item.id, { bucket: 'now' })
        store.logActivity(item.id, 'agent', `Promoted to Now (briefing${pick.reason ? `: ${pick.reason}` : ''})`)
      }
    }
    for (const demo of briefing.demotions) {
      const item = store.getItem(demo.itemId)
      if (!item || proposedIds.has(demo.itemId)) continue
      if (item.bucket === 'now') {
        store.updateItem(item.id, { bucket: 'next' })
        store.logActivity(item.id, 'agent', `Moved to Next (briefing: ${demo.reason})`)
      }
    }
    store.logActivity(null, 'you', 'Accepted proposed Now from briefing')
    notifyAndScan()
  })

  ipcMain.handle('activity:list', (_e, limit: number, itemId?: string) => store.listActivity(limit, itemId))

  ipcMain.handle('settings:set', async (_e, patch: Partial<Settings>) => {
    const merged = store.setSettings(patch)
    if ('privacyMode' in patch) applyPrivacyMode(merged.privacyMode)
    if ('provider' in patch) await brain.redetectCli()
    notifyAndScan()
  })

  ipcMain.handle('apikey:set', async (_e, key: string) => {
    setApiKey(store, String(key ?? ''))
    store.logActivity(null, 'you', 'API key updated in settings')
    await brain.redetectCli()
    notifyAndScan()
  })

  ipcMain.handle('apikey:clear', (_e) => {
    clearApiKey(store)
    store.logActivity(null, 'you', 'API key removed from settings')
    notifyAndScan()
  })

  ipcMain.handle('cost:summary', () => store.costSummary())
  ipcMain.handle('owners:list', () => store.listOwners())
  ipcMain.handle('capture:open', () => openCapture())
  ipcMain.handle('capture:close', () => closeCapture())
  ipcMain.handle('clipboard:write', (_e, text: string) => clipboard.writeText(text))
}

function describePatch(patch: Partial<Item>): string {
  if (patch.bucket) return `Moved to ${patch.bucket}`
  if (patch.title) return `Renamed to "${patch.title}"`
  if (patch.snoozedUntil) return `Snoozed until ${patch.snoozedUntil.slice(0, 10)}`
  return 'Updated'
}

function applySuggestionAction(deps: IpcDeps, suggId: string, actionId: string, extra?: { owner?: string }): void {
  const { store } = deps
  const sugg = store.getSuggestion(suggId)
  if (!sugg || sugg.status !== 'pending') return
  const item = store.getItem(sugg.itemId)
  if (!item) {
    store.resolveSuggestion(suggId, 'rejected', actionId)
    return
  }

  switch (sugg.kind) {
    case 'structure': {
      const p = sugg.payload as unknown as StructureProposal
      if (actionId === 'accept') {
        store.updateItem(item.id, {
          title: p.title,
          type: p.type,
          bucket: p.bucket,
          priority: p.priority,
          deadline: p.deadline,
          owner: p.owner ?? item.owner,
          meta: p.extra ?? item.meta
        })
        store.resolveSuggestion(suggId, 'accepted', actionId)
        store.logActivity(item.id, 'you', `Accepted proposal → ${p.bucket}`)
      } else if (actionId === 'snooze') {
        store.updateItem(item.id, { snoozedUntil: nextMonday(new Date()) }, false)
        store.resolveSuggestion(suggId, 'rejected', actionId)
        store.logActivity(item.id, 'you', 'Snoozed until Monday')
      } else {
        store.resolveSuggestion(suggId, 'rejected', actionId)
        store.logActivity(item.id, 'you', 'Dismissed capture')
        store.deleteItem(item.id)
      }
      break
    }
    case 'staleness': {
      if (actionId === 'kill') {
        store.resolveSuggestion(suggId, 'accepted', actionId)
        store.logActivity(item.id, 'you', `Killed "${item.title}" (stale)`)
        store.deleteItem(item.id)
      } else if (actionId === 'delegate') {
        store.updateItem(item.id, {
          bucket: 'waiting',
          type: 'waiting',
          owner: extra?.owner ?? item.owner,
          meta: `delegated ${new Date().toLocaleDateString()}`
        })
        store.resolveSuggestion(suggId, 'accepted', actionId)
        store.logActivity(item.id, 'you', `Delegated to ${extra?.owner ?? 'someone'}`)
      } else if (actionId === 'schedule') {
        store.updateItem(item.id, { snoozedUntil: nextMonday(new Date()) })
        store.resolveSuggestion(suggId, 'accepted', actionId)
        store.logActivity(item.id, 'you', 'Scheduled for Monday')
      } else {
        // keep: touch the item so the staleness clock restarts
        store.updateItem(item.id, {})
        store.resolveSuggestion(suggId, 'rejected', actionId)
        store.logActivity(item.id, 'you', 'Kept (staleness clock reset)')
      }
      break
    }
    case 'chase': {
      if (actionId === 'copyDraft') {
        store.updateItem(item.id, { lastNudgeAt: new Date().toISOString() }, false)
        store.resolveSuggestion(suggId, 'accepted', actionId)
        store.logActivity(item.id, 'you', `Copied chase draft for ${item.owner ?? 'owner'}`)
      } else {
        store.updateItem(item.id, { lastNudgeAt: new Date().toISOString() }, false)
        store.resolveSuggestion(suggId, 'rejected', actionId)
      }
      break
    }
    case 'now-overflow': {
      if (actionId === 'toNext') {
        store.updateItem(item.id, { bucket: 'next' })
        store.resolveSuggestion(suggId, 'accepted', actionId)
        store.logActivity(item.id, 'you', 'Moved to Next (Now overflow)')
      } else {
        store.resolveSuggestion(suggId, 'rejected', actionId)
      }
      break
    }
  }
}
