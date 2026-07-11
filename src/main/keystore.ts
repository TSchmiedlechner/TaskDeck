import { safeStorage } from 'electron'
import type { Store } from './store'

const KV_KEY = 'anthropicApiKey'

interface StoredKey {
  data: string
  encrypted: boolean
}

/** Persist the API key, encrypted with the OS credential store (DPAPI on Windows) when available. */
export function setApiKey(store: Store, key: string): void {
  const trimmed = key.trim()
  if (!trimmed) {
    clearApiKey(store)
    return
  }
  const payload: StoredKey = safeStorage.isEncryptionAvailable()
    ? { data: safeStorage.encryptString(trimmed).toString('base64'), encrypted: true }
    : { data: Buffer.from(trimmed, 'utf8').toString('base64'), encrypted: false }
  store.setKv(KV_KEY, JSON.stringify(payload))
}

export function clearApiKey(store: Store): void {
  store.setKv(KV_KEY, '')
}

export function getStoredApiKey(store: Store): string | null {
  const raw = store.getKv(KV_KEY)
  if (!raw) return null
  try {
    const payload = JSON.parse(raw) as StoredKey
    const buf = Buffer.from(payload.data, 'base64')
    return payload.encrypted ? safeStorage.decryptString(buf) : buf.toString('utf8')
  } catch {
    return null
  }
}

/** Resolve the effective key: an explicitly stored key wins over the environment. */
export function resolveApiKey(store: Store): { key: string; source: 'settings' | 'env' } | null {
  const stored = getStoredApiKey(store)
  if (stored) return { key: stored, source: 'settings' }
  const env = process.env.ANTHROPIC_API_KEY
  if (env) return { key: env, source: 'env' }
  return null
}
