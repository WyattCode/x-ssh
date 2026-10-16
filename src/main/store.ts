import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
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
    if (!(this.hostsLoadFailed && this.hosts.length === 0)) {
      await writeDurable(this.hostsFile, JSON.stringify(this.hosts, null, 2))
      this.hostsLoadFailed = false
    }
    if (!safeStorage.isEncryptionAvailable()) return
    // If a prior load couldn't decrypt secrets.bin (e.g. it was copied from
    // another machine — DPAPI is per-machine), don't clobber it with an EMPTY
    // object. But once the user actually saves a secret, persist it and clear
    // the flag: the old undecryptable data is unrecoverable here anyway, so we
    // must not stay permanently unable to save new passwords.
    if (this.secretsLoadFailed && Object.keys(this.secrets).length === 0) return
    const enc = safeStorage.encryptString(JSON.stringify(this.secrets))
    await writeDurable(this.secretsFile, enc)
    this.secretsLoadFailed = false
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

  async list(): Promise<Host[]> {
    await this.ensureLoaded()
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

    if (password !== undefined) {
      if (password) this.secrets[host.id] = password
      else delete this.secrets[host.id]
    }
    if (passphrase !== undefined) {
      if (passphrase) this.secrets[this.ppKey(host.id)] = passphrase
      else delete this.secrets[this.ppKey(host.id)]
    }
    await this.persist()
    return this.list()
  }

  async delete(id: string): Promise<Host[]> {
    await this.ensureLoaded()
    this.hosts = this.hosts.filter((h) => h.id !== id)
    delete this.secrets[id]
    delete this.secrets[this.ppKey(id)]
    await this.persist()
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

  async touch(id: string): Promise<void> {
    await this.ensureLoaded()
    const host = this.hosts.find((h) => h.id === id)
    if (host) {
      host.lastUsedAt = Date.now()
      await this.persist()
    }
  }

  /** Exports all hosts + their saved secrets to a portable JSON blob. Secrets
   *  are included in plaintext so a backup can be restored on another machine
   *  (safeStorage/DPAPI is per-machine, so re-encrypting happens on import).
   *  When the app is locked, refuse — unless `allowLocked` is set, which the
   *  scheduled auto-backup uses so it keeps running unattended. */
  async exportJson(allowLocked = false): Promise<string> {
    await this.ensureLoaded()
    if (this.locked && !allowLocked) throw new Error('已锁定，请先解锁')
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
    if (!data || !Array.isArray(data.hosts)) throw new Error('无效的备份文件')
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
    if (this.locked) throw new Error('已锁定，请先解锁')
    const byId = new Map(this.hosts.map((h) => [h.id, h]))
    const blocks = this.hosts.map((h) => {
      const lines: string[] = [`Host ${this.configAlias(h)}`]
      lines.push(`\tHostName ${h.host}`)
      lines.push(`\tPort ${h.port || 22}`)
      lines.push(`\tUser ${h.username}`)
      if (h.auth === 'key' && h.keyPath) lines.push(`\tIdentityFile ${h.keyPath}`)
      if (h.agentForward) lines.push(`\tForwardAgent yes`)
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
