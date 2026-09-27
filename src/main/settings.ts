import { app } from 'electron'
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { parseJson, readDurable, sweepTemps, writeDurable } from './durableFile'

/**
 * Tiny key-value settings store persisted to settings.json.
 *
 * Settings used to vanish every so often (external editor, snippets, history…):
 * closing the window saves `windowBounds` without awaiting it, the app quits,
 * and the process died halfway through a plain truncating `writeFile`. The next
 * launch couldn't parse the file, treated it as "no settings", and the first
 * `set()` wrote a file holding only that one key. Reads and writes now go
 * through [readDurable] / [writeDurable] (backup + atomic replace), writes join
 * their queue synchronously, and the app waits for [flush] before quitting.
 */
export class SettingsStore {
  private dir: string
  private file: string
  private data: Record<string, unknown> = {}
  private loaded = false
  private writes: Promise<void> = Promise.resolve()

  /** [dir] is only for tests; the app uses its userData folder. */
  constructor(dir?: string) {
    this.dir = dir ?? app.getPath('userData')
    this.file = join(this.dir, 'settings.json')
  }

  /** Settings on disk (main file, else its backup). {} on first run; null when
   *  files exist but none parses — callers then keep what they already have. */
  private async readData(): Promise<Record<string, unknown> | null> {
    const r = await readDurable(this.file, (buf) => {
      const v = parseJson<unknown>(buf)
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object')
      return v as Record<string, unknown>
    })
    if (r.status === 'ok') return r.value
    return r.status === 'missing' ? {} : null
  }

  private async ensure(): Promise<void> {
    if (this.loaded) return
    this.data = (await this.readData()) ?? {}
    this.loaded = true
    void sweepTemps(this.file)
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    await this.ensure()
    return this.data[key] as T | undefined
  }

  set(key: string, value: unknown): Promise<void> {
    // Serialize writes so two concurrent set() calls can't interleave their
    // read-modify-write and drop one of the two keys. Join the queue
    // *synchronously* (loading happens inside it): the window-close path calls
    // set() without awaiting and quits right after — if set() awaited anything
    // before queueing, flush() at quit time would not see this write yet.
    this.writes = this.writes
      .then(async () => {
        await this.ensure()
        await this.write(key, value)
      })
      .catch((e) => console.error('settings write failed:', key, (e as Error).message))
    return this.writes
  }

  /** Resolves once every write queued so far is on disk (call before quitting). */
  flush(): Promise<void> {
    return this.writes
  }

  private async write(key: string, value: unknown): Promise<void> {
    // Instances run side by side and share this file, so re-read it first: a
    // stale in-memory copy would silently revert whatever another instance
    // changed since we loaded. Keep our in-memory data if the re-read fails
    // (rather than dropping keys).
    const fresh = await this.readData()
    if (fresh) this.data = fresh
    if (value === undefined || value === null || value === '') delete this.data[key]
    else this.data[key] = value
    await mkdir(this.dir, { recursive: true })
    await writeDurable(this.file, JSON.stringify(this.data, null, 2))
  }
}
