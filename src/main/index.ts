import { app, BrowserWindow, globalShortcut } from 'electron'
import { join } from 'path'
import { Store } from './store'
import { Brain } from './brain'
import { Scheduler } from './scheduler'
import { registerIpc } from './ipc'
import { createCaptureWindow, createDeckWindow, positionCaptureWindow } from './windows'

let deckWin: BrowserWindow | null = null
let captureWin: BrowserWindow | null = null

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (deckWin) {
      if (deckWin.isMinimized()) deckWin.restore()
      deckWin.focus()
    }
  })

  void app.whenReady().then(() => {
    const store = new Store(join(app.getPath('userData'), 'taskdeck.db'))
    const brain = new Brain(store)
    const settings = store.getSettings()

    const broadcast = (): void => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('state-changed')
      }
    }

    const scheduler = new Scheduler(store, brain, broadcast)

    deckWin = createDeckWindow(settings.privacyMode)
    captureWin = createCaptureWindow(settings.privacyMode)

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

    registerIpc({ store, brain, scheduler, broadcast, openCapture, closeCapture, applyPrivacyMode })

    globalShortcut.register('Control+Shift+Space', openCapture)

    scheduler.start()

    deckWin.on('closed', () => {
      deckWin = null
      app.quit()
    })

    app.on('will-quit', () => {
      globalShortcut.unregisterAll()
      scheduler.stop()
    })
  })

  app.on('window-all-closed', () => {
    app.quit()
  })
}
