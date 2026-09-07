import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ManagedKey } from '../shared/types'
import { isPrivateKey, sanitizeKeyName, shouldSkipKeyFile } from '../shared/fsUtils'

const execFileAsync = promisify(execFile)

/**
 * A small library of user-managed SSH keys, stored under <dir>/keys/<id>.
 * The private key file is copied here (mode 0600) so users can generate a
 * keypair in-app and reuse it across hosts without pointing each host at a
 * separately-managed file. This never decrypts or stores passphrases.
 */
export class KeyManager {
  private readonly keysDir: string
  private readonly labelsPath: string

  constructor(dir: string) {
    this.keysDir = join(dir, 'keys')
    // Sidecar of friendly key labels (id → label) so displayed names aren't the
    // auto-generated ids. A dotfile, so KeyManager.list() ignores it.
    this.labelsPath = join(this.keysDir, '.labels.json')
  }

  private async ensureDir(): Promise<string> {
    await mkdir(this.keysDir, { recursive: true })
    return this.keysDir
  }

  async list(): Promise<ManagedKey[]> {
    await this.ensureDir()
    const names = await readdir(this.keysDir)
    const labels = await this.readLabels()
    // Concurrently describe every candidate (skipping .pub / hidden / scratch
    // files) instead of spawning ssh-keygen serially, which made the host
    // editor slow once a user had several keys.
    const jobs: Promise<ManagedKey | null>[] = []
    for (const n of names) {
      if (shouldSkipKeyFile(n)) continue
      jobs.push(
        (async (): Promise<ManagedKey | null> => {
          const p = join(this.keysDir, n)
          try {
            if (!(await stat(p)).isFile()) return null
          } catch {
            return null
          }
          return this.describe(p, n, labels[n])
        })()
      )
    }
    const out = (await Promise.all(jobs)).filter((k): k is ManagedKey => k != null)
    // Newest first when types/names are identical; keep insertion order stable.
    return out.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))
  }

  private async describe(p: string, id: string, label?: string): Promise<ManagedKey> {
    const s = await stat(p)
    const key: ManagedKey = {
      id,
      name: label || id,
      path: p,
      mtime: s.mtimeMs
    }
    // One `ssh-keygen -lf` yields both the fingerprint and the algorithm, so
    // run it together with the passphrase probe (two child processes total
    // instead of three) and parse the line once for both fields.
    const [info, passphraseProtected] = await Promise.all([
      this.describeKey(p),
      this.isPassphraseProtected(p)
    ])
    key.fingerprint = info?.fingerprint
    key.type = info?.type
    key.passphraseProtected = passphraseProtected
    return key
  }

  /** Best-effort { fingerprint, type } from one `ssh-keygen -lf` invocation. */
  private async describeKey(p: string): Promise<{ fingerprint?: string; type?: string } | undefined> {
    try {
      const { stdout } = await this.sshKeygen(['-lf', p])
      const m = stdout.trim().match(/^(\d+) (\S+) (\S+)/)
      return m ? { fingerprint: m[2], type: m[3] } : undefined
    } catch {
      return undefined
    }
  }

  /** Reads the id → friendly-label sidecar (absent when none have been set). */
  private async readLabels(): Promise<Record<string, string>> {
    try {
      const txt = await readFile(this.labelsPath, 'utf8')
      const parsed = JSON.parse(txt)
      return parsed && typeof parsed === 'object' ? parsed as Record<string, string> : {}
    } catch {
      return {}
    }
  }

  private async writeLabels(labels: Record<string, string>): Promise<void> {
    await writeFile(this.labelsPath, JSON.stringify(labels), { mode: 0o600 }).catch(() => undefined)
  }

  private async sshKeygen(args: string[]): Promise<{ stdout: string }> {
    return execFileAsync('ssh-keygen', args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }) as unknown as { stdout: string }
  }

  /** Best-effort check whether the private key at `p` is passphrase-protected.
   *  `false` = opens with an empty passphrase (unprotected); `true` = refused
   *  an empty passphrase (likely encrypted); `undefined` = couldn't determine
   *  (e.g. ssh-keygen unavailable or a read error), so callers don't assume.
   *  Only used to surface a security hint in the UI, never to restrict usage. */
  private async isPassphraseProtected(p: string): Promise<boolean | undefined> {
    try {
      await this.sshKeygen(['-y', '-P', '', '-f', p])
      // Successfully printed the public key with an empty passphrase → unprotected.
      return false
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      // A numeric exit code means ssh-keygen actually ran and refused the key,
      // i.e. it is passphrase-protected. ENOENT/EACCES/etc. mean we couldn't
      // even run it, so the protection state is unknown.
      if (code === 'ENOENT' || code === 'EACCES') return undefined
      return true
    }
  }

  /** Generates a new key pair. `type` is the algorithm (default ed25519); a
   *  non-empty passphrase leaves the private key encrypted on disk. */
  async generate(opts: { name: string; type?: string; passphrase?: string; bits?: number }): Promise<ManagedKey> {
    const dir = await this.ensureDir()
    const safe = sanitizeKeyName(opts.name)
    const id = `${safe}-${randomUUID().slice(0, 8)}`
    const priv = join(dir, id)
    const type = opts.type || 'ed25519'
    const args = ['-t', type, '-f', priv, '-N', opts.passphrase ?? '', '-C', `x-ssh-${id}`]
    if (opts.bits && type.toLowerCase().includes('rsa')) args.push('-b', String(opts.bits))
    await this.sshKeygen(args)
    const pub = `${priv}.pub`
    const pubText = await readFile(pub, 'utf8')
    // Extract type and fingerprint from the public key line; fall back to ssh-keygen -lf.
    let typeOut: string | undefined
    let fp: string | undefined
    const first = pubText.trim().split(/\s+/)[0]
    if (first) typeOut = first
    try {
      const { stdout } = await this.sshKeygen(['-lf', pub])
      fp = stdout.trim().split(/\s+/)[1]
    } catch {
      /* ignore */
    }
    // Remember the friendly label so the UI never shows the auto-generated id.
    const labels = await this.readLabels()
    labels[id] = opts.name
    await this.writeLabels(labels)
    return this.describe(priv, id, opts.name).then((k) => {
      k.type = typeOut ?? k.type
      k.fingerprint = fp ?? k.fingerprint
      return k
    })
  }

  /** Copies an existing private key file (and its .pub if present) into the
   *  library. Returns the new ManagedKey. */
  async import(srcPath: string): Promise<ManagedKey> {
    const dir = await this.ensureDir()
    const id = `${sanitizeKeyName(basename(srcPath))}-${randomUUID().slice(0, 8)}`
    const priv = join(dir, id)
    const buf = await readFile(srcPath)
    await writeFile(priv, buf, { mode: 0o600 })
    const pubSrc = `${srcPath}.pub`
    try {
      const pubBuf = await readFile(pubSrc)
      await writeFile(`${priv}.pub`, pubBuf, { mode: 0o644 })
    } catch {
      /* no .pub alongside; fine */
    }
    // Reject a copy without a valid key marker (matches PEM / OpenSSH private keys).
    if (!isPrivateKey(buf)) {
      await rm(priv, { force: true }).catch(() => {})
      await rm(`${priv}.pub`, { force: true }).catch(() => {})
      throw new Error('所选文件不是有效的私钥')
    }
    const label = basename(srcPath).replace(/\.(pem|key|pub)$/i, '')
    const labels = await this.readLabels()
    labels[id] = label
    await this.writeLabels(labels)
    return this.describe(priv, id, label)
  }

  async remove(id: string): Promise<void> {
    await this.ensureDir()
    // Only ever operate inside the key dir: refuse path traversal in the id,
    // since it arrives over IPC from the renderer.
    if (basename(id) !== id) throw new Error('非法密钥标识')
    const priv = join(this.keysDir, id)
    await rm(priv, { force: true })
    await rm(`${priv}.pub`, { force: true })
    const labels = await this.readLabels()
    if (id in labels) {
      delete labels[id]
      await this.writeLabels(labels)
    }
  }
}
