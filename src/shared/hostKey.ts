/**
 * Host-key fingerprints are stored as sha256 hex (ssh2 `hostHash: 'sha256'`).
 * People compare them against `ssh-keygen -lf …`, which prints
 * `SHA256:<base64, no padding>` — so that is the form shown everywhere.
 */
export function isFingerprintHex(fp: unknown): fp is string {
  return typeof fp === 'string' && /^[0-9a-f]{64}$/i.test(fp)
}

export function formatFingerprint(fp: string | undefined | null): string {
  if (!fp) return ''
  if (!isFingerprintHex(fp)) return fp
  const bytes = fp.match(/../g)!.map((h) => parseInt(h, 16))
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return 'SHA256:' + btoa(bin).replace(/=+$/, '')
}
