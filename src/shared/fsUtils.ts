/**
 * Pure filesystem / transfer helpers shared by the main and renderer processes.
 * Kept dependency-free (no fs, no ssh, no Electron) so they can be unit-tested.
 */

/** Joins a remote POSIX directory and a name, collapsing trailing slashes on the dir. */
export function posixJoin(dir: string, name: string): string {
  return `${dir.replace(/\/+$/, '')}/${name}`
}

/** Parent directory of a remote POSIX path ('/' for a top-level entry). */
export function parentOf(p: string): string {
  const t = p.replace(/\/+$/, '')
  const i = t.lastIndexOf('/')
  return i <= 0 ? '/' : t.slice(0, i)
}

/** Clamps a transfer-concurrency value into the supported range [1, 32]. */
export function clampConcurrency(value: number, fallback = 4): number {
  if (!Number.isFinite(value) || value < 1) return fallback
  return Math.min(32, Math.floor(value))
}

/** Shell-quotes a single remote file name for use in a `tar` argument list,
 *  escaping internal single quotes the classic POSIX way. */
export function shellQuoteName(name: string): string {
  return `'${name.replace(/'/g, "'\\''")}'`
}

/** Builds the remote `tar czf` command that archives `names` from `parent`.
 *  Uses `--force-local` so newer GNU tar won't misinterpret a leading dash in
 *  an archive path as a remote host. */
export function buildPackCommand(parent: string, tmpArchive: string, names: string[]): string {
  const cd = `cd ${JSON.stringify(parent)}`
  const quoted = names.map(shellQuoteName).join(' ')
  return `${cd} && ${quoted ? `tar czf "${tmpArchive}" ${quoted}` : ''}`.replace(/&&\s*$/, '')
}

/** Picks the remote extraction command for an archive file (zip → unzip, else tar). */
export function buildExtractCommand(remoteDir: string, archiveFileName: string): string {
  const lower = archiveFileName.toLowerCase()
  if (lower.endsWith('.zip')) return `cd ${JSON.stringify(remoteDir)} && unzip -o "${archiveFileName}"`
  return `cd ${JSON.stringify(remoteDir)} && tar xzf "${archiveFileName}"`
}

/** Removes terminal C0/C1 control characters from pasted text so a pasted blob
 *  can't trigger unexpected shell behaviour. Tab (\t) and newlines are allowed. */
export function sanitizePasteText(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
}
