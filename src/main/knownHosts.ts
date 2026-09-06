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
  private map: Record<string, string> = {}
  private loaded = false

  async load(): Promise<void> {
    if (this.loaded) return
    try {
      this.map = JSON.parse(await readFile(this.file, 'utf8'))
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
    return this.map[KnownHosts.key(host, port)]
  }

  async set(host: string, port: number, fingerprint: string): Promise<void> {
    this.map[KnownHosts.key(host, port)] = fingerprint
    await this.persist()
  }

  async forget(host: string, port: number): Promise<void> {
    delete this.map[KnownHosts.key(host, port)]
    await this.persist()
  }

  /** All known hosts, sorted by host for the settings page. */
  list(): KnownHostEntry[] {
    return Object.entries(this.map)
      .map(([key, fingerprint]) => {
        const colon = key.lastIndexOf(':')
        const port = Number(key.slice(colon + 1)) || 22
        return { host: colon > 0 ? key.slice(0, colon) : key, port, fingerprint }
      })
      .sort((a, b) => a.host.localeCompare(b.host) || a.port - b.port)
  }
}
