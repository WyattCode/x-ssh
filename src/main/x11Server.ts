/**
 * Bring up a local X server for X11 forwarding.
 *
 * A remote program cannot reach the Windows clipboard until an X server is
 * listening on 6000 + display. Asking the user to launch VcXsrv by hand and
 * keep it running forever is brittle (and an agent-installed tray app tends to
 * die with the installer's process tree), so X-SSH owns the lifecycle instead:
 * it warms the server up at startup and re-checks before each forwarded
 * connection. A server someone else already started is always reused.
 *
 * The server is spawned detached so closing X-SSH does not yank the clipboard
 * out from under other sessions; `probeTcp` keeps later launches idempotent.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { parseXauthority, readLocalX11Cookie } from './x11'

export type XServerResult = 'ready' | 'started' | 'missing' | 'failed'

export interface XServerOptions {
  host: string
  port: number
  display: string
  /** How long to wait for a freshly spawned server to bind its port. */
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
}

/** Cheap TCP liveness probe; a server that is still booting refuses fast. */
export function probeTcp(host: string, port: number, timeoutMs = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ host, port })
    let done = false
    const finish = (value: boolean): void => {
      if (done) return
      done = true
      sock.destroy()
      resolve(value)
    }
    sock.setTimeout(timeoutMs, () => finish(false))
    sock.on('connect', () => finish(true))
    sock.on('error', () => finish(false))
  })
}

/** Install locations, most likely first. The user-scoped noadmin install is
 *  first because it needs no elevation and is what our installer uses. */
export function xServerCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const local = env.LOCALAPPDATA
  const pf = env.ProgramFiles || env.PROGRAMFILES
  const pf86 = env['ProgramFiles(x86)'] || env['PROGRAMFILES(X86)']
  const out: string[] = []
  if (local) out.push(join(local, 'Programs', 'VcXsrv', 'vcxsrv.exe'))
  if (pf) out.push(join(pf, 'VcXsrv', 'vcxsrv.exe'), join(pf, 'Xming', 'Xming.exe'))
  if (pf86) out.push(join(pf86, 'VcXsrv', 'vcxsrv.exe'), join(pf86, 'Xming', 'Xming.exe'))
  out.push('C:\\Program Files\\VcXsrv\\vcxsrv.exe', 'C:\\Program Files (x86)\\VcXsrv\\vcxsrv.exe')
  return [...new Set(out)]
}

/** `XSSH_X11_AUTOSTART=0` leaves X server lifecycle entirely to the user
 *  (there may already be one on another display, or a managed VcXsrv tray).
 *  Also lets the integration tests exercise the "no local server" path
 *  without spawning a real X server on the developer's machine. */
export function findXServer(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (process.platform !== 'win32') return undefined
  if (env.XSSH_X11_AUTOSTART === '0') return undefined
  return xServerCandidates(env).find((p) => existsSync(p))
}

const AUTH_NAME = 'MIT-MAGIC-COOKIE-1'

/** Build one FamilyWild xauth entry in native (little-endian) order. */
function xauthEntry(cookie: Buffer, display: string): Buffer {
  const u16 = (n: number): Buffer => {
    const b = Buffer.alloc(2)
    b.writeUInt16LE(n)
    return b
  }
  const field = (v: Buffer | string): Buffer => {
    const s = Buffer.isBuffer(v) ? v : Buffer.from(v, 'latin1')
    return Buffer.concat([u16(s.length), s])
  }
  return Buffer.concat([
    u16(65535),
    field(''),
    field(display),
    field(AUTH_NAME),
    field(cookie)
  ])
}

/**
 * Make sure the auth file VcXsrv is started with actually contains a usable
 * cookie for *this* display. Never discard entries another tool (WSL, Xming)
 * owns: if the file has no matching entry, append one rather than replacing it.
 *
 * This matters because `boot()` passes the file via `-auth`. Reusing a file
 * that only holds, say, display "0" while $DISPLAY is ":10" makes the X server
 * reject every forwarded connection; `readLocalX11Cookie()` would also find
 * nothing, so the pseudo cookie is never rewritten and X11 silently dies.
 * Returning undefined for a file we cannot parse tells `boot()` to start the
 * server without `-auth`, which falls back to the localhost host-based rule.
 */
export async function ensureXauthority(
  display: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<string | undefined> {
  const path = env.XAUTHORITY || join(homedir(), '.Xauthority')
  try {
    if (!existsSync(path)) {
      await writeAtomic(path, xauthEntry(randomBytes(16), display))
      return path
    }
    const raw = await readFile(path)
    if (await readLocalX11Cookie(display, env)) return path
    // A file we cannot parse belongs to another tool (or is corrupt): never
    // append to or rewrite it. Give the server its own file instead of starting
    // it without `-auth`, which would fall back to host-based access — often
    // equivalent to `-ac`.
    if (!parseXauthority(raw)) {
      const alt = join(tmpdir(), `x-ssh-xauth-${process.pid}-${display}`)
      await writeAtomic(alt, xauthEntry(randomBytes(16), display))
      return alt
    }
    await writeAtomic(path, Buffer.concat([raw, xauthEntry(randomBytes(16), display)]))
    return path
  } catch {
    return undefined
  }
}

/** Temp file + rename: a crash or a second X-SSH instance never observes a
 *  half-written auth file, and the user's existing entries are never truncated. */
async function writeAtomic(path: string, data: Buffer): Promise<void> {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, data, { mode: 0o600 })
  await rename(tmp, path)
}

let child: ChildProcess | undefined
let warming: Promise<XServerResult> | undefined
let lastFailedAt = 0
/** A server that failed to boot once should not be spawned again on every
 *  paste. probeTcp() still short-circuits the moment one appears, so this
 *  cooldown never blocks a user who fixes the problem by hand. */
const FAIL_COOLDOWN_MS = 30_000

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Idempotent: concurrent callers share one boot attempt. */
export async function ensureLocalXServer(opts: XServerOptions): Promise<XServerResult> {
  const env = opts.env ?? process.env
  if (await probeTcp(opts.host, opts.port)) return 'ready'
  if (warming) return warming
  if (Date.now() - lastFailedAt < FAIL_COOLDOWN_MS) return 'failed'
  warming = boot(opts, env)
  try {
    const result = await warming
    if (result === 'failed') lastFailedAt = Date.now()
    return result
  } finally {
    warming = undefined
  }
}

async function boot(opts: XServerOptions, env: NodeJS.ProcessEnv): Promise<XServerResult> {
  const exe = findXServer(env)
  if (!exe) return 'missing'
  const auth = await ensureXauthority(opts.display, env)
  const args = [`:${opts.display}`, '-listen', 'tcp', '-clipboard', '-multiwindow']
  if (auth) args.push('-auth', auth)
  let spawnFailed = false
  try {
    child = spawn(exe, args, {
      cwd: dirname(exe),
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    child.on('error', () => {
      child = undefined
      spawnFailed = true
    })
    child.unref()
  } catch {
    return 'failed'
  }
  const deadline = Date.now() + (opts.timeoutMs ?? 25000)
  while (Date.now() < deadline) {
    if (await probeTcp(opts.host, opts.port)) return 'started'
    // A missing/unelevatable executable will never bind the port. Waiting the
    // full 25 s here used to hold every concurrent paste hostage.
    if (spawnFailed) return 'failed'
    await delay(400)
  }
  return 'failed'
}

/** For tests and shutdown paths that want to observe a fresh boot. */
export function resetXServerState(): void {
  warming = undefined
  child = undefined
  lastFailedAt = 0
}
