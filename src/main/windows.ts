import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'path'

const DECK_WIDTH = 420

function rendererUrl(page: 'index' | 'capture'): { url?: string; file?: string } {
  if (process.env.ELECTRON_RENDERER_URL) {
    return { url: `${process.env.ELECTRON_RENDERER_URL}/${page}.html` }
  }
  return { file: join(__dirname, `../renderer/${page}.html`) }
}

function load(win: BrowserWindow, page: 'index' | 'capture'): void {
  const target = rendererUrl(page)
  if (target.url) void win.loadURL(target.url)
  else void win.loadFile(target.file!)
}

export function createDeckWindow(privacyMode: boolean, alwaysOnTop: boolean): BrowserWindow {
  const wa = screen.getPrimaryDisplay().workArea
  const win = new BrowserWindow({
    width: DECK_WIDTH,
    height: wa.height,
    x: wa.x + wa.width - DECK_WIDTH,
    y: wa.y,
    minWidth: 360,
    minHeight: 500,
    frame: false,
    alwaysOnTop,
    backgroundColor: '#14161a',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  if (alwaysOnTop) win.setAlwaysOnTop(true, 'floating')
  win.setContentProtection(privacyMode)
  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  load(win, 'index')
  return win
}

export function createCaptureWindow(privacyMode: boolean): BrowserWindow {
  const win = new BrowserWindow({
    width: 620,
    height: 170,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setContentProtection(privacyMode)
  win.on('blur', () => win.hide())
  load(win, 'capture')
  return win
}

/** Center the capture spotlight on whichever display holds the cursor, at ~22% height. */
export function positionCaptureWindow(win: BrowserWindow): void {
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const wa = display.workArea
  const [w] = win.getSize()
  win.setPosition(Math.round(wa.x + (wa.width - w) / 2), Math.round(wa.y + wa.height * 0.22), false)
}
