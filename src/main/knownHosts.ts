import { app } from 'electron'
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { parseJson, readDurable, writeDurable } from './durableFile'
import type { KnownHostEntry } from '../shared/types'

/** Thrown when known_hosts.json (+.bak) is unreadable and a write would wipe prior fingerprints. */
export class KnownHostsCorruptError extends Error {
  constructor(message = 'known_hosts.json is unreadable; refusing to overwrite it') {
    super(message)
    this.name = 'KnownHostsCorruptError'
  }
}

/**
 * Trust-on-first-use store of server host-key fingerprints, keyed by
 * "host:port". First connection records the SHA-256 fingerprint; a later
 * mismatch is surfaced as a possible man-in-the-middle.
 */
export class KnownHosts {
  private dir = app.getPath('userData')
  private file = join(this.dir, 'known_hosts.json')
  private map: Record<string, { fp: string; firstSeen?: number }> = {}
  private loaded = false
  /** known_hosts.json exists but couldn't be read: don't overwrite it with an empty map. */
  private loadFailed = false

  async load(): Promise<void> {
    if (this.loaded) return
    try {
      // Crash-safe read (falls back to the .bak copy), see durableFile.ts.
      const r = await readDurable(this.file, parseJson<Record<string, unknown>>)
      if (r.status === 'bad') this.loadFailed = true
      const raw = r.status === 'ok' ? r.value : {}
      // Migrate the legacy string form (`fingerprint`) to the record form and
      // record when each key was first trusted, so stale keys can be aged out.
      for (const [key, val] of Object.entries(raw)) {
        if (typeof val === 'string') {
          this.map[key] = { fp: val, firstSeen: Date.now() }
        } else if (val && typeof (val as { fp?: unknown }).fp === 'string') {
          this.map[key] = { fp: (val as { fp: string }).fp, firstSeen: (val as { firstSeen?: number }).firstSeen }
        }
      }
    } catch {
      this.map = {}
      this.loadFailed = true
    }
    this.loaded = true
  }

  private async persist(force = false): Promise<void> {
    // Corrupt file: refuse any write that isn't a deliberate full restore (importAll).
    // The old guard only skipped when map was empty — trusting one new host then
    // wrote {thatOne} and wiped every other fingerprint.
    if (this.loadFailed && !force) throw new KnownHostsCorruptError()
    await mkdir(this.dir, { recursive: true })
    await writeDurable(this.file, JSON.stringify(this.map, null, 2))
    this.loadFailed = false
  }

  static key(host: string, port: number): string {
    return `${host}:${port || 22}`
  }

  get(host: string, port: number): string | undefined {
    return this.map[KnownHosts.key(host, port)]?.fp
  }

  async set(host: string, port: number, fingerprint: string): Promise<void> {
    if (this.loadFailed) throw new KnownHostsCorruptError()
    const k = KnownHosts.key(host, port)
    const existing = this.map[k]
    // A replaced key is a new key: its age starts now (firstSeen drives the
    // stale-key hint), only re-saving the same key keeps the original date.
    this.map[k] = { fp: fingerprint, firstSeen: existing && existing.fp === fingerprint ? existing.firstSeen ?? Date.now() : Date.now() }
    await this.persist()
  }

  async forget(host: string, port: number): Promise<void> {
    if (this.loadFailed) throw new KnownHostsCorruptError()
    delete this.map[KnownHosts.key(host, port)]
    await this.persist()
  }

  /** Replaces the whole map from a backup (known-host entries from an export).
   *  Used by data:importAll so a full restore is symmetric with the export.
   *  A user-chosen full restore is allowed to overwrite a corrupt file. */
  async importAll(entries: KnownHostEntry[]): Promise<void> {
    const map: Record<string, { fp: string; firstSeen?: number }> = {}
    for (const e of entries) {
      if (!e || typeof e.fingerprint !== 'string') continue
      map[KnownHosts.key(e.host, e.port)] = { fp: e.fingerprint, firstSeen: e.firstSeen }
    }
    this.map = map
    await this.persist(true)
  }

  /** All known hosts, sorted by host for the settings page. */
  list(): KnownHostEntry[] {
    return Object.entries(this.map)
      .map(([key, rec]) => {
        const colon = key.lastIndexOf(':')
        const port = Number(key.slice(colon + 1)) || 22
        return {
          host: colon > 0 ? key.slice(0, colon) : key,
          port,
          fingerprint: rec.fp,
          firstSeen: rec.firstSeen
        }
      })
      .sort((a, b) => a.host.localeCompare(b.host) || a.port - b.port)
  }

  /** Whether known_hosts.json failed to parse this session (writes refused). */
  status(): { loadFailed: boolean } {
    return { loadFailed: this.loadFailed }
  }
}
