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

/** True if a key-library entry name should be skipped when listing. Hidden
 *  dotfiles and bare `id_*` scratch files (no short-uuid suffix) are not user
 *  keys; generated/imported keys always carry a short-uuid suffix. */
export function shouldSkipKeyFile(name: string): boolean {
  if (name.startsWith('.')) return true
  return name.startsWith('id_') && !/-[0-9a-f]{8}$/.test(name)
}
