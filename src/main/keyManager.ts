import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
// Default import, not `import { utils }`: this file is bundled as ESM and ssh2
// is CommonJS. Node's named-export detection (cjs-module-lexer) finds `Client`
// but not `utils`, so a named import compiles fine and then throws at startup
// with "Named export 'utils' not found". The default export is module.exports,
// which always has it.
import ssh2 from 'ssh2'
import type { ManagedKey } from '../shared/types'
import { isPrivateKey, sanitizeKeyName, shouldSkipKeyFile } from '../shared/fsUtils'
import { parseJson, readDurable, writeDurable } from './durableFile'

const execFileAsync = promisify(execFile)

/**
 * A small library of user-managed SSH keys, stored under <dir>/keys/<id>.
 * The private key file is copied here (mode 0600) so users can generate a
 * keypair in-app and reuse it across hosts without pointing each host at a
 * separately-managed file. This never decrypts or stores passphrases.
 *
 * Failures the UI can name are thrown with a stable English marker as the
 * message (`'invalid-key'`, `'bad-id'` — see KeyErrorCode in shared/types), so
 * main can hand the renderer a code to translate instead of a hard-coded
 * Chinese string that an English UI would show raw.
 */
export class KeyManager {
  private readonly keysDir: string
  private readonly labelsPath: string
  /** .labels.json (+.bak) existed but none parsed — do not overwrite with {}. */
  private labelsLoadFailed = false

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
      const r = await readDurable(this.labelsPath, (buf) => {
        const v = parseJson<unknown>(buf)
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not a labels map')
        const out: Record<string, string> = {}
        for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
          if (typeof val === 'string') out[k] = val
        }
        return out
      })
      if (r.status === 'bad') {
        this.labelsLoadFailed = true
        return {}
      }
      if (r.status === 'missing') {
        this.labelsLoadFailed = false
        return {}
      }
      this.labelsLoadFailed = false
      return r.value
    } catch {
      // Unexpected throw: keep prior flag (do not clear); treat as empty map.
      return {}
    }
  }

  private async writeLabels(labels: Record<string, string>): Promise<void> {
    // A sidecar this launch could not parse must not be replaced blindly.
    //
    // The resolve path deliberately keeps the flag when the file is corrupt
    // (readLabels returns {} and leaves names intact on disk rather than
    // rewriting them away), so writing here would discard every existing
    // friendly name in exchange for the one key just handled.
    if (this.labelsLoadFailed) {
      throw new Error('labels-corrupt')
    }
    // One write, and it must be allowed to fail.
    //
    // This used to write three times in a row: once, then again inside
    // `.catch(() => undefined)` (so a real failure was swallowed and the call
    // reported success), then once more. Three truncating writes of the same
    // content — a crash between any two leaves a half-written file, which is
    // what readLabels' corrupt path then has to recover from. Callers surface
    // the error themselves (keyGenFail / keyImportFail / delete toast).
    //
    // writeDurable, not writeFile: readDurable above already falls back to
    // `<file>.bak`, but a plain writeFile never produced one, so that recovery
    // path could never actually fire. A crash mid-write lost every friendly
    // name with nothing to fall back to.
    await writeDurable(this.labelsPath, JSON.stringify(labels), 0o600)
  }

  /** Whether the labels sidecar failed to parse this session (friendly names at risk). */
  async labelsStatus(): Promise<{ loadFailed: boolean }> {
    await this.readLabels()
    return { loadFailed: this.labelsLoadFailed }
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
    await this.readLabels()
    if (this.labelsLoadFailed) throw new Error('labels-corrupt')
    const safe = sanitizeKeyName(opts.name)
    const id = `${safe}-${randomUUID().slice(0, 8)}`
    const priv = join(dir, id)
    const requested = (opts.type || 'ed25519').toLowerCase()
    const type: 'rsa' | 'ecdsa' | 'ed25519' =
      requested === 'rsa' || requested === 'ecdsa' ? requested : 'ed25519'
    // Generate in-process. The old code ran `ssh-keygen -N <passphrase>`, which
    // put the passphrase on the command line where /proc/<pid>/cmdline (or WMI
    // on Windows) exposes it to other local users — defeating the very
    // protection the passphrase is for.
    let pair: { private: string; public: string }
    try {
      pair = ssh2.utils.generateKeyPairSync(type, {
        ...(opts.bits && type === 'rsa' ? { bits: opts.bits } : {}),
        ...(opts.passphrase ? { passphrase: opts.passphrase } : {}),
        comment: `x-ssh-${id}`
      })
    } catch {
      throw new Error('keygen-failed')
    }
    await writeFile(priv, pair.private, { mode: 0o600 })
    const pub = `${priv}.pub`
    await writeFile(pub, pair.public.endsWith('\n') ? pair.public : `${pair.public}\n`, {
      mode: 0o644
    })
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
    // If the sidecar write fails, delete the new keypair — otherwise generate
    // looks successful with the typed name, then list() shows the raw id forever.
    try {
      const labels = await this.readLabels()
      labels[id] = opts.name
      await this.writeLabels(labels)
    } catch (e) {
      await rm(priv, { force: true }).catch(() => {})
      await rm(`${priv}.pub`, { force: true }).catch(() => {})
      throw e
    }
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
    await this.readLabels()
    if (this.labelsLoadFailed) throw new Error('labels-corrupt')
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
      // Stable marker: main turns this into KeyErrorCode 'invalid-key'.
      throw new Error('invalid-key')
      throw new Error('invalid-private-key')
    }
    const label = basename(srcPath).replace(/\.(pem|key|pub)$/i, '')
    try {
      const labels = await this.readLabels()
      labels[id] = label
      await this.writeLabels(labels)
    } catch (e) {
      await rm(priv, { force: true }).catch(() => {})
      await rm(`${priv}.pub`, { force: true }).catch(() => {})
      throw e
    }
    return this.describe(priv, id, label)
  }

  /** Returns the public key line for a managed key (from the .pub file, or
   *  derived from an unprotected private key). Used by "publish key to hosts". */
  async publicKey(id: string): Promise<string> {
    await this.ensureDir()
    // Stable marker: main turns this into KeyErrorCode 'bad-id'.
    if (basename(id) !== id) throw new Error('bad-id')
    const priv = join(this.keysDir, id)
    try {
      return (await readFile(`${priv}.pub`, 'utf8')).trim()
    } catch {
      // No .pub alongside — derive it, which only works for passphrase-free keys.
      const { stdout } = await this.sshKeygen(['-y', '-P', '', '-f', priv])
      return stdout.trim()
    }
  }

  async remove(id: string): Promise<void> {
    await this.ensureDir()
    // Only ever operate inside the key dir: refuse path traversal in the id,
    // since it arrives over IPC from the renderer.
    if (basename(id) !== id) throw new Error('bad-id')
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
