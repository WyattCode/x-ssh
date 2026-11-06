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
import { writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

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

/** Never overwrite an existing .Xauthority — WSL or another X tool may own it.
 *  VcXsrv's localhost host-based access makes the cookie optional anyway, so
 *  reusing a file that lacks our display is harmless. */
export async function ensureXauthority(
  display: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<string | undefined> {
  const path = env.XAUTHORITY || join(homedir(), '.Xauthority')
  if (existsSync(path)) return path
  try {
    await writeFile(path, xauthEntry(randomBytes(16), display))
    return path
  } catch {
    return undefined
  }
}

let child: ChildProcess | undefined
let warming: Promise<XServerResult> | undefined

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Idempotent: concurrent callers share one boot attempt. */
export async function ensureLocalXServer(opts: XServerOptions): Promise<XServerResult> {
  const env = opts.env ?? process.env
  if (await probeTcp(opts.host, opts.port)) return 'ready'
  if (warming) return warming
  warming = boot(opts, env)
  try {
    return await warming
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
  try {
    child = spawn(exe, args, {
      cwd: dirname(exe),
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    child.on('error', () => {
      child = undefined
    })
    child.unref()
  } catch {
    return 'failed'
  }
  const deadline = Date.now() + (opts.timeoutMs ?? 25000)
  while (Date.now() < deadline) {
    if (await probeTcp(opts.host, opts.port)) return 'started'
    await delay(400)
  }
  return 'failed'
}

/** For tests and shutdown paths that want to observe a fresh boot. */
export function resetXServerState(): void {
  warming = undefined
  child = undefined
}
