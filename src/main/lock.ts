import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { SettingsStore } from './settings'

/**
 * App master-lock. An optional user passphrase gates access to saved secrets.
 *
 * Only a scrypt hash + salt is persisted (never the passphrase). While locked,
 * the app refuses to hand out saved passwords / passphrases and refuses a full
 * backup export, so a casual user at the desk can't pull stored credentials
 * without the passphrase.
 *
 * Secrets themselves are still encrypted at rest by Electron safeStorage
 * (per-OS), so this master lock is an additional in-app gate on top of that,
 * not the only boundary. That also means a forgotten master passphrase does
 * not permanently destroy access — `reset()` clears the gate (the OS-level
 * encryption still protects the file), so the user can set a new one.
 */
const KEY = 'masterLock'

interface MasterLockData {
  salt: string
  hash: string
}

export class MasterLock {
  private salt = ''
  private hash: string | null = null
  private unlocked = true

  constructor(private settings: SettingsStore) {}

  /** Loads the stored scrypt hash (if any). Starts locked when a passphrase
   *  had been set, so a restart requires it again. */
  async load(): Promise<void> {
    const rec = await this.settings.get<MasterLockData>(KEY)
    if (rec && rec.salt && rec.hash) {
      this.salt = rec.salt
      this.hash = rec.hash
      this.unlocked = false
    } else {
      this.unlocked = true
    }
  }

  get enabled(): boolean {
    return this.hash !== null
  }

  get locked(): boolean {
    return this.enabled && !this.unlocked
  }

  status(): { enabled: boolean; locked: boolean } {
    return { enabled: this.enabled, locked: this.locked }
  }

  private derive(passphrase: string, salt: string): string {
    return scryptSync(passphrase, salt, 64).toString('hex')
  }

  private verify(passphrase: string): boolean {
    if (!this.hash) return false
    const candidate = Buffer.from(this.derive(passphrase, this.salt), 'hex')
    const stored = Buffer.from(this.hash, 'hex')
    return candidate.length === stored.length && timingSafeEqual(candidate, stored)
  }

  /** Enables (or changes) the master passphrase. The caller just succeeded in
   *  setting it, so the app stays unlocked for this session. */
  async setPassphrase(passphrase: string): Promise<void> {
    if (!passphrase) throw new Error('口令不能为空')
    const salt = randomBytes(16).toString('hex')
    this.salt = salt
    this.hash = this.derive(passphrase, salt)
    this.unlocked = true
    await this.settings.set(KEY, { salt, hash: this.hash })
  }

  /** Verifies the current passphrase, then disables the lock. */
  async disable(passphrase: string): Promise<boolean> {
    if (!this.verify(passphrase)) return false
    this.hash = null
    this.salt = ''
    this.unlocked = true
    await this.settings.set(KEY, undefined)
    return true
  }

  /** Attempts to unlock with the passphrase. Returns true on success. */
  async unlock(passphrase: string): Promise<boolean> {
    if (!this.verify(passphrase)) return false
    this.unlocked = true
    return true
  }

  /** Locks the app immediately (no-op when no passphrase is set). */
  lock(): void {
    if (this.enabled) this.unlocked = false
  }

  /** Clears the gate entirely (forgotten-passphrase recovery). The OS-level
   *  safeStorage encryption of the secrets file is unaffected. */
  async reset(): Promise<void> {
    this.hash = null
    this.salt = ''
    this.unlocked = true
    await this.settings.set(KEY, undefined)
  }
}
