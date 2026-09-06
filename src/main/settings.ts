import { app } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'

/** Tiny key-value settings store persisted to settings.json. */
export class SettingsStore {
  private dir = app.getPath('userData')
  private file = join(this.dir, 'settings.json')
  private data: Record<string, unknown> = {}
  private loaded = false
  private writes: Promise<void> = Promise.resolve()

  /** Reads and parses settings.json, retrying a few times. Instances run side by
   *  side and share this file; a plain writeFile briefly truncates it, so a
   *  concurrent reader can catch an empty/partial file. That window is a few ms,
   *  so a short retry almost always lands on the complete file. Returns null
   *  only if every attempt failed (so callers keep their existing data instead
   *  of blanking it); returns {} when the file simply doesn't exist yet. */
  private async readData(): Promise<Record<string, unknown> | null> {
    for (let attempt = 0; attempt < 4; attempt++) {
      let raw: string | undefined
      try {
        raw = await readFile(this.file, 'utf8')
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {}
      }
      if (raw !== undefined) {
        try {
          return JSON.parse(raw)
        } catch {
          /* torn read mid-write — fall through and retry */
        }
      }
      await new Promise((r) => setTimeout(r, 15))
    }
    return null
  }

  private async ensure(): Promise<void> {
    if (this.loaded) return
    this.data = (await this.readData()) ?? {}
    this.loaded = true
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    await this.ensure()
    return this.data[key] as T | undefined
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.ensure()
    // Serialize writes so two concurrent set() calls can't interleave their
    // read-modify-write and drop one of the two keys.
    this.writes = this.writes.then(() => this.write(key, value)).catch(() => undefined)
    return this.writes
  }

  /** Wait for all queued writes to hit disk. Call on quit so a just-changed
   *  setting (e.g. the theme toggle) isn't lost when the process exits. */
  async flush(): Promise<void> {
    await this.writes.catch(() => undefined)
  }

  private async write(key: string, value: unknown): Promise<void> {
    // Instances run side by side and share this file, so re-read it first: a
    // stale in-memory copy would silently revert whatever another instance
    // changed since we loaded. Keep our in-memory data if the re-read fails
    // (rather than dropping keys). Our own earlier writes are already on disk,
    // so a successful re-read keeps them too.
    const fresh = await this.readData()
    if (fresh) this.data = fresh
    if (value === undefined || value === null || value === '') delete this.data[key]
    else this.data[key] = value
    await mkdir(this.dir, { recursive: true })
    const json = JSON.stringify(this.data, null, 2)
    if (process.platform === 'win32') {
      // Windows: rename-replace EPERMs under multi-instance contention and set()
      // swallows errors, so write in place; readData()'s retry tolerates the
      // brief truncation window a concurrent reader may see.
      await writeFile(this.file, json, 'utf8')
    } else {
      // macOS/Linux: temp file + atomic rename, so a crash/quit mid-write can
      // never leave settings.json empty/truncated (blanking every setting).
      const tmp = `${this.file}.${process.pid}.tmp`
      await writeFile(tmp, json, 'utf8')
      await rename(tmp, this.file)
    }
  }
}
