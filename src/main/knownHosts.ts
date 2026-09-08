import { app } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import type { KnownHostEntry } from '../shared/types'

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

  async load(): Promise<void> {
    if (this.loaded) return
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8'))
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
    }
    this.loaded = true
  }

  private async persist(): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    await writeFile(this.file, JSON.stringify(this.map, null, 2), 'utf8')
  }

  static key(host: string, port: number): string {
    return `${host}:${port || 22}`
  }

  get(host: string, port: number): string | undefined {
    return this.map[KnownHosts.key(host, port)]?.fp
  }

  async set(host: string, port: number, fingerprint: string): Promise<void> {
    const k = KnownHosts.key(host, port)
    const existing = this.map[k]
    this.map[k] = { fp: fingerprint, firstSeen: existing?.firstSeen ?? Date.now() }
    await this.persist()
  }

  async forget(host: string, port: number): Promise<void> {
    delete this.map[KnownHosts.key(host, port)]
    await this.persist()
  }

  /** Replaces the whole map from a backup (known-host entries from an export).
   *  Used by data:importAll so a full restore is symmetric with the export. */
  async importAll(entries: KnownHostEntry[]): Promise<void> {
    const map: Record<string, { fp: string; firstSeen?: number }> = {}
    for (const e of entries) {
      if (!e || typeof e.fingerprint !== 'string') continue
      map[KnownHosts.key(e.host, e.port)] = { fp: e.fingerprint, firstSeen: e.firstSeen }
    }
    this.map = map
    await this.persist()
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
}
