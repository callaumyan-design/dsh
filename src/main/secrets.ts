/**
 * API keys never go to the renderer and are encrypted at rest with the OS keychain
 * (DPAPI on Windows, Keychain on macOS, libsecret on Linux) via Electron safeStorage.
 * If no keychain is available (some Linux setups), keys are stored obfuscated and the
 * settings page says so.
 */
import { safeStorage } from 'electron'
import { JsonFile } from './storage'

type SecretRecord = { v: string; enc: 'safe' | 'plain' }

export class Secrets {
  private store: JsonFile<Record<string, SecretRecord>>

  constructor(file: string) {
    this.store = new JsonFile(file, (raw) => (raw && typeof raw === 'object' ? (raw as Record<string, SecretRecord>) : {}))
  }

  get encrypted(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  get(id: string): string {
    const r = this.store.data[id]
    if (!r) return ''
    try {
      if (r.enc === 'safe') return safeStorage.decryptString(Buffer.from(r.v, 'base64'))
      return Buffer.from(r.v, 'base64').toString('utf8')
    } catch (e) {
      console.error('[secrets] cannot decrypt', id, e)
      return ''
    }
  }

  has(id: string): boolean {
    return !!this.store.data[id]
  }

  set(id: string, value: string): void {
    const next = { ...this.store.data }
    const v = value.trim()
    if (!v) delete next[id]
    else if (this.encrypted) next[id] = { v: safeStorage.encryptString(v).toString('base64'), enc: 'safe' }
    else next[id] = { v: Buffer.from(v, 'utf8').toString('base64'), enc: 'plain' }
    this.store.set(next)
    this.store.flush()
  }

  flush(): void {
    this.store.flush()
  }
}
