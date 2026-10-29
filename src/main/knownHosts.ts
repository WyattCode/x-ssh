import { app } from 'electron'
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { parseJson, readDurable, writeDurable } from './durableFile'
import type { KnownHostEntry } from '../shared/types'

type HostKeyRec = { fps: string[]; firstSeen?: number }

/**
 * Trust-on-first-use store of server host-key fingerprints, keyed by
 * "host:port". A host may trust several fingerprints at once so a server-side
 * key rotation can add the new key without wiping the prior trust (rolling
 * restarts / dual-key windows stay connectable on either key).
 */
export class KnownHosts {
  private dir = app.getPath('userData')
  private file = join(this.dir, 'known_hosts.json')
  private map: Record<string, HostKeyRec> = {}
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
      // Migrate legacy forms: bare string → {fp} → {fps: [...]}.
      for (const [key, val] of Object.entries(raw)) {
        const rec = normalizeRec(val)
        if (rec) this.map[key] = rec
      }
    } catch {
      this.map = {}
    }
    this.loaded = true
  }

  private async persist(): Promise<void> {
    // Unreadable file and nothing trusted this session: leave it for recovery.
    if (this.loadFailed && Object.keys(this.map).length === 0) return
    await mkdir(this.dir, { recursive: true })
    await writeDurable(this.file, JSON.stringify(this.map, null, 2))
    this.loadFailed = false
  }

  static key(host: string, port: number): string {
    return `${host}:${port || 22}`
  }

  /** Primary (oldest-listed) fingerprint, if any — used as "is anything recorded?". */
  get(host: string, port: number): string | undefined {
    return this.map[KnownHosts.key(host, port)]?.fps[0]
  }

  /** Every trusted fingerprint for this host:port (hex, lowercased). */
  getAll(host: string, port: number): string[] {
    return [...(this.map[KnownHosts.key(host, port)]?.fps ?? [])]
  }

  /** True when the presented fingerprint is one of the trusted set. */
  accepts(host: string, port: number, fingerprint: string): boolean {
    const fp = fingerprint.trim().toLowerCase()
    if (!fp) return false
    return (this.map[KnownHosts.key(host, port)]?.fps ?? []).includes(fp)
  }

  /**
   * Trust `fingerprint` for this host:port. Adds without removing prior keys
   * (rotation-safe). Re-saving an already-trusted key leaves firstSeen alone.
   */
  async set(host: string, port: number, fingerprint: string): Promise<void> {
    const k = KnownHosts.key(host, port)
    const fp = fingerprint.trim().toLowerCase()
    if (!fp) return
    const existing = this.map[k]
    if (existing) {
      if (existing.fps.includes(fp)) {
        // already trusted — keep ages
        this.map[k] = existing
      } else {
        this.map[k] = { fps: [...existing.fps, fp], firstSeen: existing.firstSeen ?? Date.now() }
      }
    } else {
      this.map[k] = { fps: [fp], firstSeen: Date.now() }
    }
    await this.persist()
  }

  async forget(host: string, port: number): Promise<void> {
    delete this.map[KnownHosts.key(host, port)]
    await this.persist()
  }

  /** Replaces the whole map from a backup (known-host entries from an export).
   *  Used by data:importAll so a full restore is symmetric with the export. */
  async importAll(entries: KnownHostEntry[]): Promise<void> {
    const map: Record<string, HostKeyRec> = {}
    for (const e of entries) {
      if (!e) continue
      const fps = collectEntryFps(e)
      if (!fps.length) continue
      map[KnownHosts.key(e.host, e.port)] = { fps, firstSeen: e.firstSeen }
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
        const fingerprints = [...rec.fps]
        return {
          host: colon > 0 ? key.slice(0, colon) : key,
          port,
          fingerprint: fingerprints[0] ?? '',
          fingerprints,
          firstSeen: rec.firstSeen
        }
      })
      .sort((a, b) => a.host.localeCompare(b.host) || a.port - b.port)
  }
}

function normalizeRec(val: unknown): HostKeyRec | null {
  if (typeof val === 'string') {
    const fp = val.trim().toLowerCase()
    return fp ? { fps: [fp], firstSeen: Date.now() } : null
  }
  if (!val || typeof val !== 'object') return null
  const o = val as { fp?: unknown; fps?: unknown; firstSeen?: number }
  if (Array.isArray(o.fps)) {
    const fps = o.fps
      .filter((x): x is string => typeof x === 'string')
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean)
    // de-dupe, keep order
    const seen = new Set<string>()
    const uniq: string[] = []
    for (const f of fps) {
      if (seen.has(f)) continue
      seen.add(f)
      uniq.push(f)
    }
    if (!uniq.length) return null
    return { fps: uniq, firstSeen: o.firstSeen }
  }
  if (typeof o.fp === 'string') {
    const fp = o.fp.trim().toLowerCase()
    return fp ? { fps: [fp], firstSeen: o.firstSeen } : null
  }
  return null
}

function collectEntryFps(e: KnownHostEntry): string[] {
  const raw = [
    ...(Array.isArray(e.fingerprints) ? e.fingerprints : []),
    ...(typeof e.fingerprint === 'string' ? [e.fingerprint] : [])
  ]
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of raw) {
    const fp = x.trim().toLowerCase()
    if (!fp || seen.has(fp)) continue
    seen.add(fp)
    out.push(fp)
  }
  return out
}
