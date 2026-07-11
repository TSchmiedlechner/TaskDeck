import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

let logDir: string | null = null
let logFile: string | null = null

export function initLogger(dir: string): void {
  mkdirSync(dir, { recursive: true })
  logDir = dir
  logFile = join(dir, 'taskdeck.log')
}

export function getLogDir(): string | null {
  return logDir
}

/** Append a line to the log file. Never throws — logging must not break the app. */
export function logToFile(level: 'info' | 'error', message: string): void {
  if (!logFile) return
  try {
    appendFileSync(logFile, `${new Date().toISOString()} [${level}] ${message}\n`)
  } catch {
    // out of disk / locked file — drop the line
  }
}
