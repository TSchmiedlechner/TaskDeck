import { clipboard, ipcMain, shell } from 'electron'
import type { Store } from './store'
import type { Brain } from './brain'
import type { Scheduler } from './scheduler'
import type { OutlookSync } from './outlook'
import type { GithubSync } from './connectors/github'
import type { JiraSync } from './connectors/jira'
import { GITHUB_TOKEN_KV } from './connectors/github'
import { JIRA_TOKEN_KV } from './connectors/jira'
import { nextMonday } from './logic'
import { getLogDir } from './logger'
import { clearApiKey, setApiKey, setEncryptedKv } from './keystore'
import type { Briefing, DeckState, Item, Settings, StructureProposal } from '@shared/types'

export interface IpcDeps {
  store: Store
  brain: Brain
  scheduler: Scheduler
  outlook: OutlookSync
  github: GithubSync
  jira: JiraSync
  broadcast: () => void
  openCapture: () => void
  closeCapture: () => void
  applyPrivacyMode: (on: boolean) => void
  applyHotkey: (accelerator: string) => boolean
  applyLaunchAtLogin: (on: boolean) => void
  applyAlwaysOnTop: (on: boolean) => void
}

export function registerIpc(deps: IpcDeps): void {
  const {
    store,
    brain,
    scheduler,
    outlook,
    github,
    jira,
    broadcast,
    openCapture,
    closeCapture,
    applyPrivacyMode,
    applyHotkey,
    applyLaunchAtLogin,
    applyAlwaysOnTop
  } = deps

  const notifyAndScan = (): void => {
    scheduler.onMutation()
    broadcast()
  }

  ipcMain.handle('state:get', async (): Promise<DeckState> => {
    return {
      items: store.listItems(),
      suggestions: store.listPendingSuggestions(),
      settings: store.getSettings(),
      brainStatus: brain.status,
      brainProvider: brain.providerId,
      keySource: brain.keySource,
      cliAvailable: brain.cliAvailable,
      pendingTriageCount: scheduler.pendingTriageCount(),
      outlook: await outlook.state(),
      github: github.state(),
      jira: jira.state()
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
    // Moving an item out of the inbox implicitly answers its pending triage proposal:
    // apply the proposed metadata, but respect the bucket the user chose.
    const item = store.getItem(id)
    if (patch.bucket && patch.bucket !== 'inbox' && item?.bucket === 'inbox') {
      resolvePendingStructureOnMove(store, id)
    }
    store.updateItem(id, patch)
    store.logActivity(id, 'you', describePatch(patch))
    notifyAndScan()
  })

  ipcMain.handle('items:complete', (_e, id: string) => {
    const item = store.getItem(id)
    if (!item) return
    store.updateItem(id, { completedAt: new Date().toISOString(), bucket: 'done' })
    store.logActivity(id, 'you', `Completed "${item.title}"`)
    // v3 write-back (opt-in): completing a mail-born item completes the flag in Outlook.
    if (store.getSettings().writeBackMail && item.source === 'outlook' && item.externalId) {
      void outlook
        .markMailHandled(item.externalId)
        .then((ok) =>
          store.logActivity(
            id,
            'system',
            ok ? 'Completed the mail flag in Outlook' : 'Could not update the mail in Outlook'
          )
        )
    }
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
    const briefing = await brain.composeBriefing(store.listItems(), store.getSettings(), outlook.todayEvents)
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
        // Promoting an inbox candidate resolves its pending proposal so the
        // triage chip doesn't travel into Now with it.
        if (item.bucket === 'inbox') resolvePendingStructureOnMove(store, item.id)
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
    if ('launchAtLogin' in patch) applyLaunchAtLogin(merged.launchAtLogin)
    if ('alwaysOnTop' in patch) applyAlwaysOnTop(merged.alwaysOnTop)
    notifyAndScan()
  })

  ipcMain.handle('hotkey:set', (_e, accelerator: string): boolean => {
    const accel = String(accelerator ?? '').trim()
    if (!accel) return false
    const ok = applyHotkey(accel)
    if (ok) {
      store.setSettings({ captureHotkey: accel })
      store.logActivity(null, 'you', `Capture hotkey changed to ${accel}`)
    } else {
      store.logActivity(null, 'system', `Hotkey "${accel}" could not be registered — kept the previous one`)
    }
    notifyAndScan()
    return ok
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

  ipcMain.handle('outlook:signin', async (): Promise<boolean> => {
    const ok = await outlook.signIn()
    notifyAndScan()
    return ok
  })

  ipcMain.handle('outlook:signout', async () => {
    await outlook.signOut()
    broadcast()
  })

  ipcMain.handle('sync:now', async () => {
    await Promise.all([outlook.syncNow(), github.syncNow(), jira.syncNow()])
    notifyAndScan()
  })

  ipcMain.handle('connector:setToken', (_e, connector: 'github' | 'jira', token: string) => {
    const kvKey = connector === 'github' ? GITHUB_TOKEN_KV : JIRA_TOKEN_KV
    setEncryptedKv(store, kvKey, String(token ?? '').trim())
    store.logActivity(null, 'you', `${connector} token updated`)
    const sync = connector === 'github' ? github : jira
    sync.start()
    void sync.syncNow().then(() => notifyAndScan())
    broadcast()
  })

  ipcMain.handle('connector:clearToken', (_e, connector: 'github' | 'jira') => {
    const kvKey = connector === 'github' ? GITHUB_TOKEN_KV : JIRA_TOKEN_KV
    setEncryptedKv(store, kvKey, '')
    store.logActivity(null, 'you', `${connector} token removed`)
    ;(connector === 'github' ? github : jira).stop()
    broadcast()
  })

  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    const parsed = new URL(String(url))
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') void shell.openExternal(parsed.href)
  })

  ipcMain.handle('logs:open', () => {
    const dir = getLogDir()
    if (dir) void shell.openPath(dir)
  })
}

/**
 * When an inbox item is moved manually, apply its pending proposal's metadata
 * (clean title, type, priority, deadline, owner) and mark the suggestion accepted —
 * the caller applies the user's chosen bucket afterwards.
 */
function resolvePendingStructureOnMove(store: Store, itemId: string): void {
  const sugg = store.getPendingSuggestion(itemId, 'structure')
  if (!sugg?.payload) return
  const p = sugg.payload as unknown as StructureProposal
  const item = store.getItem(itemId)
  if (!item) return
  store.updateItem(itemId, {
    title: p.title,
    type: p.type,
    priority: p.priority,
    deadline: p.deadline,
    owner: p.owner ?? item.owner,
    meta: p.extra ?? item.meta
  })
  store.resolveSuggestion(sugg.id, 'accepted', 'accept-move')
  store.logActivity(itemId, 'you', 'Accepted proposal (moved manually)')
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
      // "accept-<bucket>" accepts the proposal but files it where the user says.
      const overrides: Record<string, StructureProposal['bucket']> = {
        'accept-now': 'now',
        'accept-next': 'next',
        'accept-someday': 'someday'
      }
      if (actionId === 'accept' || actionId in overrides) {
        const bucket = overrides[actionId] ?? p.bucket
        store.updateItem(item.id, {
          title: p.title,
          type: p.type,
          bucket,
          priority: p.priority,
          deadline: p.deadline,
          owner: p.owner ?? item.owner,
          meta: p.extra ?? item.meta
        })
        store.resolveSuggestion(suggId, 'accepted', actionId)
        store.logActivity(
          item.id,
          'you',
          `Accepted proposal → ${bucket}${bucket !== p.bucket ? ` (overrode suggested ${p.bucket})` : ''}`
        )
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
    case 'resolved': {
      if (actionId === 'done') {
        // No mail write-back here: the source already told us it's resolved, so
        // there is nothing left to complete on its side.
        store.updateItem(item.id, { completedAt: new Date().toISOString(), bucket: 'done' })
        store.resolveSuggestion(suggId, 'accepted', actionId)
        store.logActivity(item.id, 'you', `Completed "${item.title}" (resolved at the source)`)
      } else {
        store.resolveSuggestion(suggId, 'rejected', actionId)
        store.logActivity(item.id, 'you', 'Kept it open although the source resolved')
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
