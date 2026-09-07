import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ManagedKey } from '../shared/types'
import { isPrivateKey, sanitizeKeyName } from '../shared/fsUtils'

const execFileAsync = promisify(execFile)

/**
 * A small library of user-managed SSH keys, stored under <dir>/keys/<id>.
 * The private key file is copied here (mode 0600) so users can generate a
 * keypair in-app and reuse it across hosts without pointing each host at a
 * separately-managed file. This never decrypts or stores passphrases.
 */
export class KeyManager {
  private readonly keysDir: string

  constructor(dir: string) {
    this.keysDir = join(dir, 'keys')
  }

  private async ensureDir(): Promise<string> {
    await mkdir(this.keysDir, { recursive: true })
    return this.keysDir
  }

  async list(): Promise<ManagedKey[]> {
    await this.ensureDir()
    const names = await readdir(this.keysDir)
    const out: ManagedKey[] = []
    for (const n of names) {
      if (n.startsWith('.') || n.startsWith('id_')) continue
      const p = join(this.keysDir, n)
      if (!(await stat(p)).isFile()) continue
      out.push(await this.describe(p, n))
    }
    // Newest first when types/names are identical; keep insertion order stable.
    return out.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))
  }

  private async describe(p: string, name: string): Promise<ManagedKey> {
    const s = await stat(p)
    const key: ManagedKey = {
      id: name,
      name,
      path: p,
      mtime: s.mtimeMs
    }
    // Best-effort fingerprint / algorithm from `ssh-keygen -lf`. Skipped if not
    // installed or the file isn't a key, so a stale/malformed key won't error out.
    try {
      const { stdout } = await this.sshKeygen(['-lf', p])
      const m = stdout.trim().match(/^(\d+) (\S+) (\S+)/)
      if (m) {
        key.fingerprint = m[2]
        key.type = m[3]
      }
    } catch {
      /* ignore — key still usable for connect */
    }
    return key
  }

  private async sshKeygen(args: string[]): Promise<{ stdout: string }> {
    return execFileAsync('ssh-keygen', args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }) as unknown as { stdout: string }
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
    return this.describe(priv, id).then((k) => {
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
      throw new Error('所选文件不是有效的私钥')
    }
    return this.describe(priv, id)
  }

  async remove(id: string): Promise<void> {
    await this.ensureDir()
    const priv = join(this.keysDir, id)
    await rm(priv, { force: true })
    await rm(`${priv}.pub`, { force: true })
  }
}
