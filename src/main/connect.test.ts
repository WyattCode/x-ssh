import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createConnection, type AddressInfo } from 'node:net'
import { Server, utils } from 'ssh2'
import type { ConnectParams, JumpConfig } from '../shared/types'

let dir = ''
vi.mock('electron', () => ({ app: { getPath: () => dir } }))

const { SshManager } = await import('./ssh')
const { KnownHosts } = await import('./knownHosts')

const H = '127.0.0.1'
const entry = (p: number) => KnownHosts.key(H, p)
// `map` is private at the type level only; read it through an untyped handle
// to seed each test's records in memory (avoiding the shared file, which would
// bleed across tests).
const mapOf = (kh: unknown) =>
  (kh as { map: Record<string, { fp: string; firstSeen?: number }> }).map

// Counters over the fake servers, shared with the handlers below.
let shells = 0
let tunnels = 0

// One ed25519 host key shared by both fake servers.
const hostKey = utils.generateKeyPairSync('ed25519')
// The exact string the verifier receives: sha256-hex of the wire public key
// (ssh2 hashes it itself when `hostHash: 'sha256'` is set).
const realFp = createHash('sha256')
  .update((utils.parseKey(hostKey.private) as { getPublicSSH(): Buffer }).getPublicSSH())
  .digest('hex')

// Where an approved jump hop tunnels direct-tcpip to (the standing-in target).
// With an empty port the hop never forwards: its tunnel channels open and die
// exactly like a dead bastion would present them.
let tunnelDest = { host: '', port: 0 }

/** An sshd stand-in: one shared host key, password u / p, a one-line shell. */
function makeServer(): Server {
  const s = new Server({ hostKeys: [hostKey.private] }, (client) => {
    client.on('authentication', (ctx) => {
      const ok = ctx.method === 'password' && ctx.username === 'u' && ctx.password === 'p'
      ;(ok ? ctx.accept() : ctx.reject(['password'])) as unknown
    })
    client.on('ready', () => {
      client.on('session', (accept) => {
        const sess = accept()
        // Approve the pseudo-terminal so the shell request can open: a real
        // host has one, even if the stand-in does not.
        sess.on('pty', (a) => a())
        sess.on('shell', (a) => {
          shells++
          a().write('$ ')
        })
        sess.on('exec', (a) => a().end())
      })
      // ssh2 hands direct-tcpip opens on the server as a 'tcpip' event with
      // { destIP, destPort, srcIP, srcPort }.
      const raw = client as unknown as {
        on: (
          ev: 'tcpip',
          fn: (
            accept: () => import('node:stream').Duplex,
            reject: (reason?: number) => void,
            data: { destIP?: string; destPort?: number }
          ) => void
        ) => void
      }
      raw.on('tcpip', (accept, reject, data) => {
        if (
          tunnelDest.port &&
          data?.destIP === tunnelDest.host &&
          data?.destPort === tunnelDest.port
        ) {
          tunnels++
          const stream = accept()
          const up = createConnection(tunnelDest.port, tunnelDest.host)
          up.on('connect', () => {
            up.pipe(stream) // client -> hop -> target
            stream.pipe(up) // target -> hop -> client
          })
          up.on('error', () => stream.end())
          stream.on('close', () => up.end())
          up.on('close', () => stream.end())
        } else {
          reject(3) // CONNECT_FAILED: nothing approved for this destination
        }
      })
    })
    client.on('error', () => undefined)
  })
  return s
}

let targetServer: Server
let jumpServer: Server
let port = 0
let jumpPort = 0

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'xssh-connect-'))
  targetServer = makeServer()
  jumpServer = makeServer()
  await new Promise<void>((r) => targetServer.listen(0, '127.0.0.1', () => r()))
  port = (targetServer.address() as AddressInfo).port
  await new Promise<void>((r) => jumpServer.listen(0, '127.0.0.1', () => r()))
  jumpPort = (jumpServer.address() as AddressInfo).port
})

afterAll(async () => {
  targetServer.close()
  jumpServer.close()
  await rm(dir, { recursive: true, force: true })
})

const sender: { isDestroyed: () => boolean; send: ReturnType<typeof vi.fn> } = {
  isDestroyed: () => false,
  send: vi.fn()
}

/** A KnownHosts holding exactly the `host:port → fp` records named, in memory only. */
async function hosts(records: Record<string, string>) {
  const kh = new KnownHosts()
  await kh.load()
  const m = mapOf(kh)
  for (const [k, fp] of Object.entries(records)) m[k] = { fp, firstSeen: 0 }
  return kh
}

const target = (over: Partial<ConnectParams> = {}): ConnectParams =>
  ({ host: H, port, username: 'u', auth: 'password', password: 'p', ...over }) as ConnectParams

const makeJump = (): JumpConfig => ({
  host: H,
  port: jumpPort,
  username: 'u',
  auth: 'password' as JumpConfig['auth'],
  password: 'p'
})

describe('SshManager.connect (host-key verification)', () => {
  it('connects when the host key is already on record', async () => {
    tunnelDest = { host: '', port: 0 }
    const shellsBefore = shells
    const kh = await hosts({ [entry(port)]: realFp })
    const mgr = new SshManager(sender as never, kh)
    const res = await mgr.connect(target())
    expect(res, JSON.stringify(res)).toMatchObject({ ok: true })
    expect(res.sessionId).toBeTruthy()
    expect(res.code).toBeUndefined()
    expect(shells).toBe(shellsBefore + 1)
    void mgr.disconnect(res.sessionId!)
  })

  it('refuses an unrecorded key, returns its fingerprint, records nothing', async () => {
    tunnelDest = { host: '', port: 0 }
    const shellsBefore = shells
    const kh = await hosts({}) // the target record is absent
    const mgr = new SshManager(sender as never, kh)
    const res = await mgr.connect(target())
    expect(res.ok).toBe(false)
    expect(res.code).toBe('host_key_unknown')
    expect(res.key).toBe(realFp) // the presented key, for the user to confirm
    expect(res.keyHost).toBe(H)
    expect(res.keyPort).toBe(port)
    expect(shells).toBe(shellsBefore) // the credential never went through
    // No silent trust-on-first-use: the record is still empty after the
    // refusal (the manager holds this very instance, so `kh` is authoritative).
    expect(mapOf(kh)[entry(port)]).toBeUndefined()
  })

  it('lets the user trust only the key it just refused, for that host, once', async () => {
    tunnelDest = { host: '', port: 0 }
    const kh = await hosts({})
    const mgr = new SshManager(sender as never, kh)
    // Nothing refused yet: nothing can be trusted (a renderer can't plant keys).
    expect(mgr.takeRejectedKey(H, port, realFp)).toBe(false)
    const res = await mgr.connect(target())
    expect(res.code).toBe('host_key_unknown')
    expect(mgr.takeRejectedKey(H, port, 'f'.repeat(64))).toBe(false) // another key
    expect(mgr.takeRejectedKey(H, port + 1, realFp)).toBe(false) // another port
    expect(mgr.takeRejectedKey(H, port, realFp.toUpperCase())).toBe(true) // the refused one
    expect(mgr.takeRejectedKey(H, port, realFp)).toBe(false) // and only once
  })

  it('refuses a changed host key, returns the new fingerprint, keeps the old record', async () => {
    tunnelDest = { host: '', port: 0 }
    const shellsBefore = shells
    const stale = 'f'.repeat(64) // deliberately not this server's fingerprint
    const kh = await hosts({ [entry(port)]: stale })
    const mgr = new SshManager(sender as never, kh)
    const res = await mgr.connect(target())
    expect(res.ok).toBe(false)
    expect(res.code).toBe('host_key_changed')
    expect(res.key).toBe(realFp) // the presented (new) key, for the user to confirm
    expect(res.keyHost).toBe(H)
    expect(res.keyPort).toBe(port)
    expect(shells).toBe(shellsBefore)
    expect(mapOf(kh)[entry(port)]?.fp).toBe(stale) // the old record is left intact
  })

  it('refuses an unrecorded jump before the user credential goes through it', async () => {
    tunnelDest = { host: '', port: 0 }
    const shellsBefore = shells
    const tunnelsBefore = tunnels
    const kh = await hosts({}) // the jump record is absent
    const mgr = new SshManager(sender as never, kh)
    const res = await mgr.connect(target({ jump: makeJump() }))
    expect(res.ok).toBe(false)
    expect(res.code).toBe('host_key_unknown')
    expect(res.key).toBe(realFp)
    expect(res.keyHost).toBe(H)
    expect(res.keyPort).toBe(jumpPort) // the JUMP hop presented this key
    expect(shells).toBe(shellsBefore) // neither hop ever took the terminal
    expect(tunnels).toBe(tunnelsBefore) // so no tunnel was ever forwarded
    expect(mapOf(kh)[entry(jumpPort)]).toBeUndefined() // and the hop was never trusted
  })

  it('reaches the target through an approved jump (tunnel)', async () => {
    tunnelDest = { host: H, port } // the jump now forwards to the target
    const shellsBefore = shells
    const tunnelsBefore = tunnels
    const kh = await hosts({ [entry(port)]: realFp, [entry(jumpPort)]: realFp })
    const mgr = new SshManager(sender as never, kh)
    const res = await mgr.connect(target({ jump: makeJump() }))
    expect(res, JSON.stringify(res)).toMatchObject({ ok: true })
    expect(res.sessionId).toBeTruthy()
    expect(shells).toBe(shellsBefore + 1) // a real terminal past the hop
    expect(tunnels).toBe(tunnelsBefore + 1)
    void mgr.disconnect(res.sessionId!)
  })
})

describe('SshManager.execRemote (timeout)', () => {
  it('gives up on a command that never closes', async () => {
    // The stand-in accepts the exec and never ends it — a tar waiting on stdin
    // or a command stuck on a hung mount. Without a limit, every caller of
    // pack / unzip / checksum waited forever with no way to cancel.
    const stuck = new Server({ hostKeys: [hostKey.private] }, (client) => {
      client.on('authentication', (ctx) => {
        const ok = ctx.method === 'password' && ctx.username === 'u' && ctx.password === 'p'
        ;(ok ? ctx.accept() : ctx.reject(['password'])) as unknown
      })
      client.on('ready', () => {
        client.on('session', (accept) => {
          const sess = accept()
          sess.on('pty', (a) => a())
          sess.on('shell', (a) => a().write('$ '))
          sess.on('exec', (a) => void a())
        })
      })
      client.on('error', () => undefined)
    })
    await new Promise<void>((r) => stuck.listen(0, '127.0.0.1', () => r()))
    const p = (stuck.address() as AddressInfo).port
    const kh = await hosts({ [entry(p)]: realFp })
    const mgr = new SshManager(sender as never, kh)
    mgr.execTimeoutMs = 150
    const res = await mgr.connect(target({ port: p }))
    expect(res, JSON.stringify(res)).toMatchObject({ ok: true })
    const started = Date.now()
    await expect(
      mgr.packAndDownload(res.sessionId!, [{ path: '/tmp/a.txt', name: 'a.txt', isDir: false }], dir)
    ).rejects.toThrow('远端命令超时')
    expect(Date.now() - started).toBeLessThan(5000)
    void mgr.disconnect(res.sessionId!)
    stuck.close()
  })
})
