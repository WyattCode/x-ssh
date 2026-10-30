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
 *
 * Corrupt fail-closed: when neither settings.json nor its .bak parses, the
 * store reports `status() === 'bad'` and refuses to write — otherwise the first
 * `set()` (windowBounds on every close) would replace the unreadable file with
 * a single-key one and wipe snippets, snapshots, queues, etc.
 */
export class SettingsStore {
  private dir: string
  private file: string
  private data: Record<string, unknown> = {}
  private loaded = false
  private writes: Promise<void> = Promise.resolve()
  /** settings.json (+.bak) existed but none parsed — do not overwrite with {}. */
  private loadFailed = false

  /** [dir] is only for tests; the app uses its userData folder. */
  constructor(dir?: string) {
    this.dir = dir ?? app.getPath('userData')
    this.file = join(this.dir, 'settings.json')
  }

  /** Settings on disk (main file, else its backup). */
  private async readData(): Promise<{
    status: 'ok' | 'missing' | 'bad'
    data: Record<string, unknown>
  }> {
    const r = await readDurable(this.file, (buf) => {
      const v = parseJson<unknown>(buf)
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object')
      return v as Record<string, unknown>
    })
    if (r.status === 'ok') return { status: 'ok', data: r.value }
    if (r.status === 'missing') return { status: 'missing', data: {} }
    return { status: 'bad', data: {} }
  }

  private async ensure(): Promise<void> {
    if (this.loaded) return
    const r = await this.readData()
    this.data = r.data
    this.loadFailed = r.status === 'bad'
    this.loaded = true
    void sweepTemps(this.file)
  }

  /** 'bad' = file(s) on disk unreadable this launch (left untouched). */
  async status(): Promise<'ok' | 'bad'> {
    await this.ensure()
    return this.loadFailed ? 'bad' : 'ok'
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
    // before joining, flush() at quit time would not see this write yet.
    // Recover from a prior failure so one disk error cannot block every later
    // key; still reject `op` so callers (and IPC) see this write failed.
    const op = this.writes
      .catch(() => undefined)
      .then(async () => {
        await this.ensure()
        await this.write(key, value)
      })
    this.writes = op.catch((e) => {
      console.error('settings write failed:', key, (e as Error).message)
    })
    return op
  }

  /** Resolves once every write queued so far is on disk (call before quitting). */
  flush(): Promise<void> {
    return this.writes
  }

  private async write(key: string, value: unknown): Promise<void> {
    // Instances run side by side and share this file, so re-read it first: a
    // stale in-memory copy would silently revert whatever another instance
    // changed since we loaded.
    const fresh = await this.readData()
    // Both main and .bak unreadable: refuse so we do not replace them with a
    // single-key file (windowBounds on every close used to wipe snippets etc.).
    if (fresh.status === 'bad') {
      this.loadFailed = true
      throw new Error('settings.json unreadable — refusing to overwrite')
    }
    if (fresh.status === 'ok') this.data = fresh.data
    if (value === undefined || value === null || value === '') delete this.data[key]
    else this.data[key] = value
    await mkdir(this.dir, { recursive: true })
    await writeDurable(this.file, JSON.stringify(this.data, null, 2))
    this.loadFailed = false
  }
}
