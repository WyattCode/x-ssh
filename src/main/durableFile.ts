import { readFile, writeFile, rename, unlink, copyFile, readdir, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

/**
 * Crash-safe reads and writes for the app's data files (settings.json,
 * hosts.json, secrets.bin, known_hosts.json).
 *
 * A plain `writeFile` truncates the file first and then writes it. If the
 * process dies in between — the app quitting right after an un-awaited save is
 * enough — the file is left empty or cut off. The stores then failed to parse
 * it, started from "nothing saved", and the next save wrote that nothing back:
 * settings (and, with the same code, the whole host list) silently disappeared.
 *
 * `writeDurable` writes the full new content to `<file>.bak` first, then
 * replaces `<file>` via write-temp-then-rename. At every instant at least one
 * of the two holds a complete copy. On Windows the rename fails with EPERM/EBUSY
 * while another process briefly has the file open, so it is retried; if it keeps
 * failing we write in place (not atomic, but the backup already has this
 * content). `readDurable` falls back to the backup when the main file is
 * missing, empty or unparsable, and keeps an unreadable main file aside as
 * `<file>.corrupt` instead of letting the next write erase the evidence.
 */

export type DurableRead<T> =
  | { status: 'ok'; value: T; fromBackup: boolean }
  /** Neither the file nor its backup exists (first run). */
  | { status: 'missing' }
  /** Files exist but none could be parsed — callers must not overwrite blindly. */
  | { status: 'bad' }

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES'])

async function readOne<T>(path: string, parse: (buf: Buffer) => T): Promise<{ value: T } | 'missing' | 'bad'> {
  // A few quick retries: another instance may be mid-write (in-place fallback).
  for (let attempt = 0; attempt < 4; attempt++) {
    let buf: Buffer | undefined
    try {
      buf = await readFile(path)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'
    }
    if (buf && buf.length > 0) {
      try {
        return { value: parse(buf) }
      } catch {
        /* torn or corrupt — retry */
      }
    }
    await new Promise((r) => setTimeout(r, 15))
  }
  return 'bad'
}

export async function readDurable<T>(path: string, parse: (buf: Buffer) => T): Promise<DurableRead<T>> {
  const main = await readOne(path, parse)
  if (typeof main === 'object') return { status: 'ok', value: main.value, fromBackup: false }
  if (main === 'bad') await copyFile(path, `${path}.corrupt`).catch(() => undefined)
  const bak = await readOne(`${path}.bak`, parse)
  if (typeof bak === 'object') return { status: 'ok', value: bak.value, fromBackup: true }
  if (main === 'missing' && bak === 'missing') return { status: 'missing' }
  return { status: 'bad' }
}

/** Writes to the same file queue up (per process): two at once would share one temp file. */
const queues = new Map<string, Promise<void>>()

export function writeDurable(path: string, data: string | Buffer, mode?: number): Promise<void> {
  const prev = queues.get(path) ?? Promise.resolve()
  const next = prev.catch(() => undefined).then(() => writeNow(path, data, mode))
  queues.set(path, next)
  // Drop the entry once idle so the map doesn't grow; only if nothing queued after us.
  void next.finally(() => {
    if (queues.get(path) === next) queues.delete(path)
  }).catch(() => undefined)
  return next
}

async function writeNow(path: string, data: string | Buffer, mode?: number): Promise<void> {
  const opts = mode === undefined ? undefined : { mode }
  // 1) Complete copy in the backup first.
  await writeFile(`${path}.bak`, data, opts)
  // 2) Atomic replace of the main file. Per-process temp name so two instances
  //    writing at the same moment don't share (and clobber) one temp file.
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, data, opts)
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      await rename(tmp, path)
      return
    } catch (e) {
      if (!RETRYABLE.has((e as NodeJS.ErrnoException).code ?? '')) break
      await new Promise((r) => setTimeout(r, 25 * (attempt + 1)))
    }
  }
  await unlink(tmp).catch(() => undefined)
  await writeFile(path, data, opts)
}

/** Removes temp files a crashed write left behind (`<file>.<pid>.tmp`, older than a minute). */
export async function sweepTemps(path: string): Promise<void> {
  const dir = dirname(path)
  const prefix = `${basename(path)}.`
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return
  }
  const cutoff = Date.now() - 60_000
  for (const name of names) {
    if (!name.startsWith(prefix) || !/\.\d+\.tmp$/.test(name)) continue
    const full = join(dir, name)
    try {
      if ((await stat(full)).mtimeMs < cutoff) await unlink(full)
    } catch {
      /* raced with its owner — fine */
    }
  }
}

/** Parser for JSON files; rejects empty content so it counts as unreadable. */
export function parseJson<T>(buf: Buffer): T {
  const text = buf.toString('utf8')
  if (!text.trim()) throw new Error('empty')
  return JSON.parse(text) as T
}
