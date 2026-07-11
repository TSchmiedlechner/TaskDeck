import { app, BrowserWindow, globalShortcut, Menu, nativeImage, Tray } from 'electron'
import { join } from 'path'
import trayIconPath from '../../resources/tray.png?asset'
import { Store } from './store'
import { initLogger } from './logger'
import { Brain } from './brain'
import { Scheduler } from './scheduler'
import { OutlookSync } from './outlook'
import { GithubSync } from './connectors/github'
import { JiraSync } from './connectors/jira'
import { registerIpc } from './ipc'
import { createCaptureWindow, createDeckWindow, positionCaptureWindow } from './windows'

let deckWin: BrowserWindow | null = null
let captureWin: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let registeredHotkey: string | null = null

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => showDeck())

  void app.whenReady().then(() => {
    initLogger(join(app.getPath('userData'), 'logs'))
    const store = new Store(join(app.getPath('userData'), 'taskdeck.db'))
    const brain = new Brain(store)
    const settings = store.getSettings()

    const broadcast = (): void => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('state-changed')
      }
    }

    const scheduler = new Scheduler(store, brain, broadcast)

    const outlook = new OutlookSync(store, broadcast, (prompt) => {
      deckWin?.webContents.send('outlook-devicecode', prompt)
    })
    const github = new GithubSync(store, broadcast)
    const jira = new JiraSync(store, broadcast)

    deckWin = createDeckWindow(settings.privacyMode)
    captureWin = createCaptureWindow(settings.privacyMode)

    // Closing the deck hides it — TaskDeck lives in the tray until Quit.
    deckWin.on('close', (e) => {
      if (!quitting) {
        e.preventDefault()
        deckWin?.hide()
      }
    })

    // Auto-open the briefing on the first interaction of each day.
    deckWin.on('focus', () => {
      if (!store.getSettings().autoBriefing) return
      const today = new Date().toISOString().slice(0, 10)
      if (store.getKv('lastAutoBriefing') !== today) {
        store.setKv('lastAutoBriefing', today)
        deckWin?.webContents.send('show-briefing')
      }
    })

    const openCapture = (): void => {
      if (!captureWin || captureWin.isDestroyed()) {
        captureWin = createCaptureWindow(store.getSettings().privacyMode)
      }
      positionCaptureWindow(captureWin)
      captureWin.show()
      captureWin.focus()
      captureWin.webContents.send('capture-shown')
    }

    const closeCapture = (): void => {
      if (captureWin && !captureWin.isDestroyed()) captureWin.hide()
    }

    const applyPrivacyMode = (on: boolean): void => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.setContentProtection(on)
      }
    }

    const applyHotkey = (accelerator: string): boolean => {
      const previous = registeredHotkey
      if (previous) globalShortcut.unregister(previous)
      try {
        if (globalShortcut.register(accelerator, openCapture)) {
          registeredHotkey = accelerator
          return true
        }
      } catch {
        // invalid accelerator string
      }
      if (previous && globalShortcut.register(previous, openCapture)) registeredHotkey = previous
      return false
    }

    const applyLaunchAtLogin = (on: boolean): void => {
      if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: on })
    }

    registerIpc({
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
      applyLaunchAtLogin
    })

    // Resume connector syncs for whatever is already configured.
    void outlook.state().then((s) => {
      if (s.signedIn) {
        outlook.start()
        void outlook.syncNow()
      }
    })
    for (const sync of [github, jira]) {
      if (sync.state().configured) {
        sync.start()
        void sync.syncNow()
      }
    }

    if (!applyHotkey(settings.captureHotkey)) {
      store.logActivity(null, 'system', `Could not register hotkey "${settings.captureHotkey}" — is another app using it?`)
    }
    applyLaunchAtLogin(settings.launchAtLogin)

    tray = new Tray(nativeImage.createFromPath(trayIconPath))
    tray.setToolTip('TaskDeck')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Show deck', click: () => showDeck() },
        { label: 'Quick capture', click: openCapture },
        {
          label: 'Morning briefing',
          click: () => {
            showDeck()
            deckWin?.webContents.send('show-briefing')
          }
        },
        { type: 'separator' },
        { label: 'Quit TaskDeck', click: () => app.quit() }
      ])
    )
    tray.on('click', () => showDeck())

    scheduler.start()

    app.on('before-quit', () => {
      quitting = true
    })

    app.on('will-quit', () => {
      globalShortcut.unregisterAll()
      scheduler.stop()
      outlook.stop()
      github.stop()
      jira.stop()
      tray?.destroy()
    })
  })

  app.on('window-all-closed', () => {
    // keep running in the tray
  })
}

function showDeck(): void {
  if (!deckWin || deckWin.isDestroyed()) return
  if (deckWin.isMinimized()) deckWin.restore()
  deckWin.show()
  deckWin.focus()
}
