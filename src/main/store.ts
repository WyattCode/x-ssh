import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { mkdir, copyFile } from 'node:fs/promises'
import { parseJson, readDurable, writeDurable } from './durableFile'
import type { Host, HostOs } from '../shared/types'

/**
 * Drop the fields that describe the *current session* rather than the saved
 * profile, so they never reach hosts.json: the two `hasSaved*` flags are filled
 * in by `list()` from the secrets map.
 */
function stripRuntimeFlags(host: Host): Host {
  const { hasSavedPassword: _p, hasSavedPassphrase: _pp, ...rest } = host
  return rest
}

/**
 * Flat-file host store. Hosts live in hosts.json (non-secret metadata).
 * Passwords, when the user opts to save them, are encrypted per-OS via
 * Electron safeStorage and kept in a separate secrets file.
 */
export class HostStore {
  private dir = app.getPath('userData')
  private hostsFile = join(this.dir, 'hosts.json')
  private secretsFile = join(this.dir, 'secrets.bin')
  private hosts: Host[] = []
  private secrets: Record<string, string> = {}
  private loaded = false
  private secretsLoadFailed = false
  /**
   * hosts.json exists but neither it nor its backup could be read. Starting from an
   * empty list is unavoidable, but persisting that empty list would erase the file
   * for good — every saved host gone. Same rule as secrets below.
   */
  private hostsLoadFailed = false
  private locked = false

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    await mkdir(this.dir, { recursive: true })
    // Crash-safe reads (fall back to the .bak copy written before every save),
    // see durableFile.ts. A half-written hosts.json used to parse as "no hosts".
    const hosts = await readDurable(this.hostsFile, (buf) => {
      const v = parseJson<unknown>(buf)
      if (!Array.isArray(v)) throw new Error('not a host list')
      return v as Host[]
    })
    this.hosts = hosts.status === 'ok' ? hosts.value : []
    this.hostsLoadFailed = hosts.status === 'bad'
    if (safeStorage.isEncryptionAvailable()) {
      const secrets = await readDurable(this.secretsFile, (buf) =>
        JSON.parse(safeStorage.decryptString(buf)) as Record<string, string>
      )
      this.secrets = secrets.status === 'ok' ? secrets.value : {}
      // The file exists but could not be decrypted — do NOT let a later
      // persist() overwrite it with an empty object and lose the passwords.
      this.secretsLoadFailed = secrets.status === 'bad'
    }
    this.loaded = true
  }

  private async persist(): Promise<void> {
    // A hosts.json this launch could not read must not be replaced.
    //
    // The guard used to be `hostsLoadFailed && hosts.length === 0` — the same
    // "is it empty?" mistake the secrets vault had. Adding a host makes the
    // array non-empty, the guard falls away, and the unreadable file is
    // overwritten with the one host the user just typed: every other saved
    // host is lost. Whether the write is safe cannot depend on how many rows
    // we happen to hold — the file on disk is unreadable either way.
    //
    // `.corrupt` already holds the failed read (see readDurable), so refusing
    // keeps the data recoverable; overwriting does not.
    if (this.hostsLoadFailed) {
      throw new Error('hosts-unreadable: refusing to overwrite an unreadable host list')
    }
    await writeDurable(this.hostsFile, JSON.stringify(this.hosts, null, 2))
    if (!safeStorage.isEncryptionAvailable()) return
    // An existing vault this launch could not decrypt must never be replaced.
    //
    // The guard used to be `secrets.length === 0`, i.e. "don't clobber it with
    // an EMPTY object". Typing a single new password made the object non-empty
    // and the guard fell away: the unreadable file was overwritten with one
    // entry, silently discarding every password it still held. Emptiness was
    // the wrong question — the vault is unreadable either way, so whether this
    // write is safe cannot depend on how many entries we happen to hold.
    //
    // Refusing is the only honest option: the data on disk is recoverable (the
    // file is left untouched, and .corrupt records the failed read), while an
    // overwrite is not. save() turns this into a visible error so the user
    // learns the password was not stored instead of finding out at connect
    // time.
    if (this.secretsLoadFailed) {
      throw new Error('secrets-unreadable: refusing to overwrite an unreadable vault')
    }
    const enc = safeStorage.encryptString(JSON.stringify(this.secrets))
    await writeDurable(this.secretsFile, enc)
  }

  private ppKey(id: string): string {
    return `pp:${id}`
  }

  /** The app master-lock is active: saved secrets must not leave the store.
   *  Callers (connect / backup) should refuse discovery or use as well. */
  setLocked(locked: boolean): void {
    this.locked = locked
  }

  get isLocked(): boolean {
    return this.locked
  }

  /** Whether the OS-encrypted secrets vault could be read this launch.
   *  'missing' = no safeStorage (tests / unsupported) — not an error.
   *  'bad' = secrets.bin existed but could not be decrypted (left untouched). */
  async secretsStatus(): Promise<'ok' | 'missing' | 'bad'> {
    await this.ensureLoaded()
    if (!safeStorage.isEncryptionAvailable()) return 'missing'
    return this.secretsLoadFailed ? 'bad' : 'ok'
  }

  /** Whether hosts.json could be read this launch. 'bad' means the file (and
   *  its .bak) exist but neither parsed — the user's host list is still on
   *  disk, but nothing may overwrite it until they choose to start over. */
  async hostsStatus(): Promise<'ok' | 'bad'> {
    await this.ensureLoaded()
    return this.hostsLoadFailed ? 'bad' : 'ok'
  }

  async list(): Promise<Host[]> {
    await this.ensureLoaded()
    // Corrupt hosts.json (and .bak) leaves hosts=[] while persist() refuses to
    // overwrite. Returning [] made the Connect page look like "no hosts".
    // Reject so the renderer can keep its prior list and toast.
    if (this.hostsLoadFailed) {
      throw new Error('hosts-load-failed: hosts.json could not be read')
    }
    return [...this.hosts]
      .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))
      .map((h) => ({
        ...h,
        // While locked, don't advertise that secrets are stored.
        hasSavedPassword: !this.locked && !!this.secrets[h.id],
        hasSavedPassphrase: !this.locked && !!this.secrets[this.ppKey(h.id)]
      }))
  }

  async save(
    host: Host,
    password?: string,
    passphrase?: string
  ): Promise<Host[]> {
    await this.ensureLoaded()
    // Never persist runtime-only flags.
    const clean = stripRuntimeFlags(host)
    const idx = this.hosts.findIndex((h) => h.id === clean.id)
    if (idx >= 0) this.hosts[idx] = clean
    else this.hosts.push(clean)

    // Remember the pre-edit vault so a failed write can be rolled back. Without
    // this, a save that threw left the *in-memory* vault holding only what this
    // call touched, and the next successful save wrote that reduced set to disk
    // — one failed edit could quietly drop every other saved password.
    const secretsBefore = { ...this.secrets }
    const unreadableBefore = this.secretsLoadFailed
    const wroteSecret = password !== undefined || passphrase !== undefined

    if (password !== undefined) {
      if (password) this.secrets[host.id] = password
      else delete this.secrets[host.id]
    }
    if (passphrase !== undefined) {
      if (passphrase) this.secrets[this.ppKey(host.id)] = passphrase
      else delete this.secrets[this.ppKey(host.id)]
    }
    try {
      // persist() writes hosts.json first, then the vault — so a vault failure
      // still leaves the host edit saved, which is the right split: losing the
      // profile because a password could not be stored would be worse.
      await this.persist()
    } catch (e) {
      // Put the vault back so a later save can't persist the half-applied set.
      this.secrets = secretsBefore
      this.secretsLoadFailed = unreadableBefore
      // The renderer tells "host kept, password not stored" apart by the
      // `secrets-` prefix; anything else is a genuine save failure.
      throw e
    }
    // A typed secret must actually be in the vault, not just in memory. This
    // covers the case persist() skips silently: no OS encryption at all.
    //
    // Both secrets are checked, not just the password: a key-only host saves a
    // passphrase with no password, and verifying only `password` meant that
    // path could report success with nothing written.
    if (wroteSecret) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('secrets-unavailable: no OS encryption, secret not stored')
      }
      const ppk = this.ppKey(host.id)
      const lost =
        (password !== undefined && password !== '' && this.secrets[host.id] !== password) ||
        (passphrase !== undefined && passphrase !== '' && this.secrets[ppk] !== passphrase)
      if (lost) {
        throw new Error('secrets-not-persisted: secret did not reach the vault')
      }
    }
    return this.list()
  }

  /** Whether the OS can encrypt the secrets vault on this machine. */
  isEncryptionAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  /** Whether this launch failed to read an existing vault (so writes are risky). */
  get secretsUnreadable(): boolean {
    return this.secretsLoadFailed
  }

  /**
   * Discards an unreadable vault so saving passwords works again.
   *
   * `persist()` refuses to overwrite a vault it could not decrypt (that is what
   * kept the old passwords recoverable instead of silently erasing them), but
   * refusing forever would leave the app unable to store any password. This is
   * the explicit way out: the caller has told the user what is being given up,
   * and the old file is kept beside the new one rather than deleted.
   */
  async resetSecrets(): Promise<void> {
    await this.ensureLoaded()
    if (!this.secretsLoadFailed) return
    // Keep the unreadable original: it may still be decryptable on the machine
    // it came from, so this stays a "start over here", not a destruction.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    await copyFile(this.secretsFile, `${this.secretsFile}.unreadable-${stamp}`).catch(
      () => undefined
    )
    this.secrets = {}
    this.secretsLoadFailed = false
    await this.persist()
  }

  /**
   * Discards an unreadable hosts.json so hosts can be saved again.
   *
   * `persist()` refuses to overwrite a host list it could not read (that keeps
   * the file recoverable instead of replacing it with whatever is in memory),
   * but refusing forever would leave the app unable to save any host. Like
   * [resetSecrets], the unreadable file is renamed aside rather than deleted.
   */
  async resetHosts(): Promise<void> {
    await this.ensureLoaded()
    if (!this.hostsLoadFailed) return
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    await copyFile(this.hostsFile, `${this.hostsFile}.unreadable-${stamp}`).catch(() => undefined)
    this.hosts = []
    this.hostsLoadFailed = false
    await this.persist()
  }

  async delete(id: string): Promise<Host[]> {
    await this.ensureLoaded()
    // Roll back on a failed write. Without this, the host stays deleted in
    // memory while still on disk: the renderer asked, got an error and kept
    // showing the host, but the next unrelated save persists the reduced list
    // and the host disappears without anyone asking again.
    const hostsBefore = this.hosts
    const hadPassword = this.secrets[id]
    const hadPassphrase = this.secrets[this.ppKey(id)]
    this.hosts = this.hosts.filter((h) => h.id !== id)
    delete this.secrets[id]
    delete this.secrets[this.ppKey(id)]
    try {
      await this.persist()
    } catch (e) {
      this.hosts = hostsBefore
      if (hadPassword !== undefined) this.secrets[id] = hadPassword
      if (hadPassphrase !== undefined) this.secrets[this.ppKey(id)] = hadPassphrase
      // Normalise to the same code list() uses: to the caller it is one
      // problem ("the host list could not be read"), whether they tried to
      // read, delete or save.
      if ((e as Error).message.startsWith('hosts-unreadable')) {
        throw new Error('hosts-load-failed: hosts.json could not be read')
      }
      throw e
    }
    return this.list()
  }

  async getPassword(id: string): Promise<string | undefined> {
    await this.ensureLoaded()
    if (this.locked) return undefined
    return this.secrets[id]
  }

  async getPassphrase(id: string): Promise<string | undefined> {
    await this.ensureLoaded()
    if (this.locked) return undefined
    return this.secrets[this.ppKey(id)]
  }

  /** Records the OS detected on connect. Returns whether anything changed, so
   *  the caller only tells the renderer to reload when it has to. */
  async setOs(id: string, os: HostOs, at?: { host: string; port?: number }): Promise<boolean> {
    await this.ensureLoaded()
    const host = this.hosts.find((h) => h.id === id)
    if (!host || (host.os?.id === os.id && host.os?.pretty === os.pretty)) return false
    // Read from an address the host no longer has (edited meanwhile): not its OS.
    if (at && (host.host !== at.host || (host.port || 22) !== (at.port || 22))) return false
    host.os = os
    await this.persist()
    return true
  }

  /** Bumps a host to the top of the "recent" list after a successful connect. */
  async touch(id: string): Promise<void> {
    await this.ensureLoaded()
    const host = this.hosts.find((h) => h.id === id)
    if (!host) return
    host.lastUsedAt = Date.now()
    try {
      await this.persist()
    } catch (e) {
      // `lastUsedAt` only orders the "recent" list. A failed write must not
      // fail the connection that just succeeded — and with persist() now
      // refusing to overwrite an unreadable host list, this would otherwise
      // throw on every successful connect for as long as the file stays bad.
      // Put the stamp back so the in-memory list matches the disk.
      host.lastUsedAt = undefined
      console.error('store: touch failed:', (e as Error).message)
    }
  }

  /** Exports all hosts + their saved secrets to a portable JSON blob. Secrets
   *  are included in plaintext so a backup can be restored on another machine
   *  (safeStorage/DPAPI is per-machine, so re-encrypting happens on import).
   *  When the app is locked, refuse — unless `allowLocked` is set, which the
   *  scheduled auto-backup uses so it keeps running unattended. */
  async exportJson(allowLocked = false): Promise<string> {
    await this.ensureLoaded()
    if (this.locked && !allowLocked) throw new Error('app-locked')
    const hosts = this.hosts.map((h) => ({
      ...h,
      password: this.secrets[h.id] ?? '',
      passphrase: this.secrets[this.ppKey(h.id)] ?? ''
    }))
    return JSON.stringify({ app: 'x-ssh', version: 1, exportedAt: Date.now(), hosts }, null, 2)
  }

  /** Replaces the host list (and their secrets) from an exported JSON blob.
   *  Returns the number of imported hosts. Existing hosts are replaced. */
  async importJson(json: string): Promise<{ count: number }> {
    await this.ensureLoaded()
    const data = JSON.parse(json)
    if (!data || !Array.isArray(data.hosts)) throw new Error('invalid-backup')
    const imported: Host[] = []
    const newSecrets: Record<string, string> = {}
    for (const h of data.hosts) {
      if (!h || typeof h.id !== 'string' || typeof h.host !== 'string') continue
      const { password, passphrase, ...rest } = h
      imported.push(stripRuntimeFlags(rest))
      if (password) newSecrets[h.id as string] = password
      if (passphrase) newSecrets[this.ppKey(h.id as string)] = passphrase
    }
    this.hosts = imported
    this.secrets = newSecrets
    this.secretsLoadFailed = false
    await this.persist()
    return { count: imported.length }
  }

  /** Builds an OpenSSH `~/.ssh/config` block from the saved hosts. Secrets are
   *  NOT exported (identity files / agent are referenced, never embedded). */
  async exportSshConfig(): Promise<string> {
    await this.ensureLoaded()
    if (this.locked) throw new Error('app-locked')
    const byId = new Map(this.hosts.map((h) => [h.id, h]))
    const blocks = this.hosts.map((h) => {
      const lines: string[] = [`Host ${this.configAlias(h)}`]
      lines.push(`\tHostName ${h.host}`)
      lines.push(`\tPort ${h.port || 22}`)
      lines.push(`\tUser ${h.username}`)
      if (h.auth === 'key' && h.keyPath) lines.push(`\tIdentityFile ${h.keyPath}`)
      if (h.agentForward) lines.push(`\tForwardAgent yes`)
      if (h.x11Forward) lines.push(`\tForwardX11 yes`)
      if (h.jumpHostId) {
        const j = byId.get(h.jumpHostId)
        if (j) lines.push(`\tProxyJump ${this.configAlias(j)}`)
      }
      if (h.proxy && h.proxy.type === 'http') {
        // Proxy credentials are NOT exported either — the config file gets
        // shared/committed far more casually than the secrets store, and the
        // comment above promises no secrets in here.
        lines.push(`\t# ProxyCommand needs the proxy's credentials: fill in user:password yourself`)
        lines.push(`\t# ProxyCommand connect-proxy -H user:password@${h.proxy.host}:${h.proxy.port} %h %p`)
      }
      if (h.onConnect) lines.push(`\tRemoteCommand ${h.onConnect.split('\n').join(' && ')}`)
      if (h.group) lines.push(`\t# group: ${h.group}`)
      return lines.join('\n')
    })
    return blocks.join('\n\n') + '\n'
  }

  /** A stable, unique alias for a host used in `Host` blocks / ProxyJump. Falls
   *  back to `user@host` then the host itself when empty/duplicate. */
  private configAlias(h: Host): string {
    const base = h.label.trim() || (h.username ? `${h.username}@${h.host}` : h.host)
    // Collapse to a single token; OpenSSH Host patterns are space-separated.
    return base.replace(/[ \t]+/g, '-')
  }
}
