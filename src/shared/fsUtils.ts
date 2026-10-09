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

/** Builds the remote `tar czf` command that archives `names` (relative to
 *  `parent`) into `tmpArchive`. Runs `cd <parent>` first so names aren't
 *  given as absolute paths. */
export function buildPackCommand(parent: string, tmpArchive: string, names: string[]): string {
  const cd = `cd ${shellQuoteName(parent)}`
  const quoted = names.map(shellQuoteName).join(' ')
  return `${cd} && ${quoted ? `tar czf ${shellQuoteName(tmpArchive)} ${quoted}` : ''}`.replace(/&&\s*$/, '')
}

/** Picks the remote extraction command for an archive file (zip → unzip, else tar). */
export function buildExtractCommand(remoteDir: string, archiveFileName: string): string {
  const lower = archiveFileName.toLowerCase()
  if (lower.endsWith('.zip')) return `cd ${shellQuoteName(remoteDir)} && unzip -o ${shellQuoteName(archiveFileName)}`
  return `cd ${shellQuoteName(remoteDir)} && tar xzf ${shellQuoteName(archiveFileName)}`
}

/** Removes terminal C0/C1 control characters from pasted text so a pasted blob
 *  can't trigger unexpected shell behaviour. Tab (\t) and newlines are allowed. */
export function sanitizePasteText(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
}

/** A PRIVATE KEY marker that lets us reject a non-key file before copying it
 *  into the key library. Covers OpenSSH / PEM (RSA, EC, DSA) and PKCS#8. */
const PRIVATE_KEY_RE =
  /-----BEGIN (?:(?:OPENSSH|RSA|EC|DSA|ENCRYPTED) )?PRIVATE KEY-----/

/** True if a file's contents look like an SSH/PEM private key. */
export function isPrivateKey(contents: string | Buffer): boolean {
  return PRIVATE_KEY_RE.test(typeof contents === 'string' ? contents : contents.toString('utf8'))
}

/** Sanitizes a user-supplied key name into a safe filename fragment. Guarantees
 *  a non-empty result that is not "." or ".." and doesn't start with a dot, so
 *  generated/imported key ids are never mistaken for hidden/ignored files. */
export function sanitizeKeyName(name: string): string {
  let safe = (name || 'id').replace(/[^\w.-]/g, '_')
  safe = safe.replace(/^\.+/, '')
  if (safe === '' || safe === '.' || safe === '..') safe = 'id'
  return safe
}

/** True if a key-library entry name should be skipped when listing. Skips
 *  companion `.pub` files, hidden dotfiles and bare `id_*` scratch files (no
 *  short-uuid suffix); generated/imported keys always carry a short-uuid
 *  suffix and have no `.pub` extension. */
export function shouldSkipKeyFile(name: string): boolean {
  if (name.endsWith('.pub')) return true
  if (name.startsWith('.')) return true
  return name.startsWith('id_') && !/-[0-9a-f]{8}$/.test(name)
}

/**
 * Windows counterpart of [posixJoin], for the local pane of the file drawer.
 *
 * The two are separate on purpose: the remote side is always POSIX, while the
 * local side is whatever this machine uses. `posixJoin('/C:/Users', 'x')` would
 * produce a forward-slash path, which Windows accepts but the drawer's breadcrumb
 * parsing then splits differently — so the local pane keeps its own backslashes.
 * Accepts either separator on input and always emits `\`.
 */
export function windowsJoin(dir: string, name: string): string {
  return dir.replace(/[\\/]+$/, '') + '\\' + name
}

/**
 * Windows counterpart of [parentOf]: the containing directory, or `p` itself
 * when there is nothing above it (a bare drive root such as `C:\`).
 */
export function windowsParent(p: string): string {
  const norm = p.replace(/[\\/]+$/, '')
  if (!norm) return p
  // A drive keeps its separator: to Windows a bare `C:` means "the current
  // directory on drive C", not its root — `path.normalize('C:')` is `C:.` — so
  // going up from `C:\Users` must land on `C:\`, and `C:\` has nothing above it.
  if (DRIVE.test(norm)) return norm + '\\'
  const idx = Math.max(norm.lastIndexOf('\\'), norm.lastIndexOf('/'))
  if (idx <= 0) return norm
  const parent = norm.slice(0, idx)
  return DRIVE.test(parent) ? parent + '\\' : parent
}

/** A bare drive letter with its colon, e.g. `C:`. */
const DRIVE = /^[A-Za-z]:$/

/**
 * True when `p` is a Windows path: a drive (`C:\…`, `C:/…`, `C:`) or UNC (`\\server\…`).
 *
 * The local pane follows the shape of the path it is showing rather than a
 * platform flag: the path came from this machine (`local:home`, a folder the user
 * picked), so its own form says which rules apply. On macOS / Linux the local side
 * is POSIX, and joining with `\` there produced names like `/Users/me\notes.txt`.
 */
export function isWindowsPath(p: string): boolean {
  return /^[A-Za-z]:([\\/]|$)/.test(p) || p.startsWith('\\\\')
}

/** Join a name onto a local directory, with this machine's separator. */
export function localJoin(dir: string, name: string): string {
  return isWindowsPath(dir) ? windowsJoin(dir, name) : posixJoin(dir, name)
}

/** The containing local directory (see [windowsParent] / [parentOf]). */
export function localParent(p: string): string {
  return isWindowsPath(p) ? windowsParent(p) : parentOf(p)
}

/**
 * The mode a **directory** gets when one mode is applied to a whole tree.
 *
 * A directory without execute ("search") permission cannot be entered — applying
 * 644 to a tree used to leave every folder in it unreachable. So wherever the
 * chosen mode grants read, grant execute too: chmod's `X`, for directories.
 * Files keep the chosen mode exactly; setuid / setgid / sticky bits pass through.
 */
export function treeDirMode(mode: number): number {
  return mode | ((mode & 0o444) >> 2)
}
