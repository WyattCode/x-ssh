/**
 * Path rules for the renderer-facing local-filesystem IPC (`local:*`).
 *
 * These channels exist so the SFTP drawer can browse and manage the local side
 * of a transfer. The renderer supplies both the directory and, for mutations,
 * the entry name — and `join()` alone does not contain the result: `join('/a',
 * '../..')` walks out, and `join('/a', '/etc/passwd')` discards `/a` entirely.
 * A renderer that has been compromised (or a bug that builds a name from
 * remote-supplied data) could therefore reach anything the user can.
 *
 * The rule here is deliberately narrow: a name must be a single path segment.
 * Callers keep passing a directory and a name, as before; they simply can no
 * longer pass a name that is not one.
 */
import { basename, isAbsolute, join, normalize, sep } from 'node:path'

/** Windows rejects these in file names outright, and they break path parsing. */
const WINDOWS_RESERVED = /[<>:"|?*\u0000-\u001f]/

/** Refused on every platform: a NUL truncates the path at the C layer. */
const NUL = /\u0000/

export interface PathCheck {
  ok: boolean
  /** Why the input was refused, for the log line (never shown raw to users). */
  reason?: string
}

/**
 * True when `name` is usable as the final segment of a path under a directory.
 * Refuses separators, `..`, absolute paths, drive letters and NUL everywhere.
 *
 * The Windows-only rules (reserved characters, a trailing dot or space) apply
 * only on Windows. The same checks guard renaming and deleting **existing**
 * entries, and on macOS / Linux a name like `backup-10:30.tar` is ordinary —
 * refusing it there would leave files the local pane can list but not delete.
 * `platform` is a parameter so the tests can exercise both rule sets.
 */
export function isSafeEntryName(
  name: unknown,
  platform: NodeJS.Platform = process.platform
): PathCheck {
  if (typeof name !== 'string' || name.length === 0) {
    return { ok: false, reason: 'empty name' }
  }
  if (name === '.' || name === '..') {
    return { ok: false, reason: 'relative path segment' }
  }
  // Both separators: the app runs on Windows, but a name arriving with a
  // forward slash must be refused there too.
  if (name.includes('/') || name.includes('\\')) {
    return { ok: false, reason: 'name contains a path separator' }
  }
  if (isAbsolute(name)) {
    return { ok: false, reason: 'absolute path' }
  }
  if (NUL.test(name)) {
    return { ok: false, reason: 'illegal character' }
  }
  if (platform === 'win32') {
    if (WINDOWS_RESERVED.test(name)) {
      return { ok: false, reason: 'illegal character' }
    }
    // A trailing dot or space is silently stripped by Windows, so the name the
    // user sees would not be the file that gets created.
    if (/[. ]$/.test(name)) {
      return { ok: false, reason: 'trailing dot or space' }
    }
  }
  if (basename(name) !== name) {
    return { ok: false, reason: 'not a single path segment' }
  }
  return { ok: true }
}

/**
 * Resolve `name` inside `dir`, refusing anything that would land outside it.
 *
 * Returns the absolute target path, or null when the input is unsafe. The
 * containment test is done on the normalized result rather than by string
 * inspection, so it holds however the pieces were combined.
 */
export function resolveInside(
  dir: unknown,
  name: unknown,
  platform: NodeJS.Platform = process.platform
): string | null {
  if (typeof dir !== 'string' || dir.length === 0) return null
  if (!isSafeEntryName(name, platform).ok) return null
  // `name` is a single segment, so joining it to the normalized base cannot
  // escape: `..`, separators and absolute paths were all refused above.
  const base = normalize(dir)
  const target = normalize(join(base, name as string))
  // Keep the containment check anyway — it is what makes this function safe on
  // its own, without depending on isSafeEntryName growing no new holes.
  // Note the separator on the base: `normalize('C:\\')` keeps its trailing
  // separator, and root directories are legitimate places to create a file.
  if (!isInside(base, target)) return null
  return target
}

/** True when `target` is strictly below `base` (not equal to it). */
function isInside(base: string, target: string): boolean {
  if (target === base) return false
  const prefix = base.endsWith('\\') || base.endsWith('/') ? base : base + sep
  return target.startsWith(prefix)
}

/**
 * Normalize a directory the renderer wants to browse or write into.
 *
 * Browsing anywhere is not itself a privilege escalation — the local pane is a
 * file manager, and the user can point it at any folder. This exists so the
 * value is at least resolved and well-formed before it reaches `fs`.
 */
export function resolveDir(dir: unknown): string | null {
  if (typeof dir !== 'string' || dir.length === 0) return null
  if (dir.includes('\u0000')) return null
  return normalize(dir)
}