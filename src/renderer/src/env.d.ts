import type { TaskdeckApi } from '@shared/types'

declare global {
  interface Window {
    taskdeck: TaskdeckApi
  }
}

export {}
