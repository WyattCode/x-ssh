import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createConnection, createServer, type AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import { Server, utils } from 'ssh2'
import type { ConnectParams } from '../shared/types'

let dir = ''
vi.mock('electron', () => ({ app: { getPath: () => dir } }))

const { SshManager } = await import('./ssh')
const { KnownHosts } = await import('./knownHosts')

const H = '127.0.0.1'

/** Every shell channel the stand-in sshd opened, newest last. */
const shells: Duplex[] = []

const hostKey = utils.generateKeyPairSync('ed25519')
const realFp = createHash('sha256')
  .update((utils.parseKey(hostKey.private) as { getPublicSSH(): Buffer }).getPublicSSH())
  .digest('hex')

const mapOf = (kh: unknown) =>
  (kh as { map: Record<string, { fps: string[]; firstSeen?: number }> }).map

let activeClients = 0

function makeServer(): Server {
  return new Server({ hostKeys: [hostKey.private] }, (client) => {
    client.on('ready', () => {
      activeClients++
    })
    client.on('close', () => {
      activeClients--
    })
    client.on('authentication', (ctx) => {
      const ok = ctx.method === 'password' && ctx.username === 'u' && ctx.password === 'p'
      ;(ok ? ctx.accept() : ctx.reject(['password'])) as unknown
    })
    client.on('ready', () => {
      client.on('session', (accept) => {
        const sess = accept()
        sess.on('pty', (a) => a())
        sess.on('shell', (a) => {
          const ch = a()
          shells.push(ch)
          ch.write('$ ')
          // Echo back so a test can prove the channel is still alive.
          ch.on('data', (d: Buffer) => ch.write('ECHO:' + d.toString('utf8')))
        })
        sess.on('exec', (a) => a().end())
      })
    })
    client.on('error', () => undefined)
  })
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function waitFor(fn: () => boolean, ms = 4000): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (fn()) return true
    await delay(20)
  }
  return fn()
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, H, () => {
      const p = (s.address() as AddressInfo).port
      s.close(() => resolve(p))
    })
  })
}

function canConnect(port: number, ms = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ host: H, port })
    const done = (ok: boolean): void => {
      sock.removeAllListeners()
      sock.destroy()
      resolve(ok)
    }
    sock.once('connect', () => done(true))
    sock.once('error', () => done(false))
    const t = setTimeout(() => done(false), ms)
    t.unref?.()
  })
}

let server: Server
let port = 0

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'xssh-lifecycle-'))
  server = makeServer()
  await new Promise<void>((r) => server.listen(0, H, () => r()))
  port = (server.address() as AddressInfo).port
})

afterAll(async () => {
  server.close()
  await rm(dir, { recursive: true, force: true })
})

const sends: unknown[][] = []
const sender = {
  isDestroyed: () => false,
  send: vi.fn((...args: unknown[]) => {
    sends.push(args)
  })
}

async function hosts(): Promise<InstanceType<typeof KnownHosts>> {
  const kh = new KnownHosts()
  await kh.load()
  mapOf(kh)[KnownHosts.key(H, port)] = { fps: [realFp.toLowerCase()], firstSeen: 0 }
  return kh
}

const target = (over: Partial<ConnectParams> = {}): ConnectParams =>
  ({
    host: H,
    port,
    username: 'u',
    auth: 'password',
    password: 'p',
    ...over
  }) as ConnectParams

describe('multiplexed session teardown', () => {
  it('keeps a peer pane usable after another pane disconnects', async () => {
    const mgr = new SshManager(sender as never, await hosts())
    const a = await mgr.connect(target({ multiplex: true }))
    const b = await mgr.connect(target({ multiplex: true }))
    expect(a.ok && b.ok).toBe(true)
    expect(shells.length).toBeGreaterThanOrEqual(2)
    // Output is parked until the renderer attaches; the peer's echo must reach
    // the IPC channel for this assertion to mean anything.
    mgr.attach(a.sessionId!)
    mgr.attach(b.sessionId!)

    mgr.disconnect(a.sessionId!)
    // Let the shell 'close' that stream.end() triggers run.
    await delay(150)

    sends.length = 0
    mgr.write(b.sessionId!, 'ping\n')
    const alive = await waitFor(() => sends.some((args) => JSON.stringify(args).includes('ECHO:ping')))
    expect(alive, 'peer pane stopped working after its sibling disconnected').toBe(true)
    mgr.disposeAll()
  })

  it('ends a plain session’s client when its shell exits, even if the host has a master', async () => {
    const mgr = new SshManager(sender as never, await hosts())
    const shared = await mgr.connect(target({ multiplex: true }))
    const plain = await mgr.connect(target()) // same host, multiplex off
    expect(shared.ok && plain.ok).toBe(true)
    expect(await waitFor(() => activeClients === 2)).toBe(true)

    // The remote shell ends by itself; nothing calls disconnect().
    shells[shells.length - 1].end()
    // A master exists for this host, but this session does not belong to it:
    // keeping the client alive here leaked one connection per exit.
    expect(await waitFor(() => activeClients === 1)).toBe(true)
    mgr.disposeAll()
  })

  it('releases a local forward port when the remote shell exits', async () => {
    const mgr = new SshManager(sender as never, await hosts())
    const localPort = await freePort()
    const r = await mgr.connect(
      target({
        portForwards: [
          { mode: 'local', localPort, remoteHost: '127.0.0.1', remotePort: 9 }
        ] as ConnectParams['portForwards']
      })
    )
    expect(r.ok).toBe(true)
    expect(await canConnect(localPort), 'forward never bound').toBe(true)

    // The remote shell ends on its own — not an explicit disconnect().
    shells[shells.length - 1].end()
    await delay(400)

    const rebind = await new Promise<boolean>((resolve) => {
      const s = createServer()
      s.once('error', () => resolve(false))
      s.listen(localPort, H, () => s.close(() => resolve(true)))
    })
    expect(rebind, 'local forward kept its port after the session died').toBe(true)
    mgr.disposeAll()
  })
})

describe('rejected host keys', () => {
  it('remembers every key refused for the same host', () => {
    const mgr = new SshManager(sender as never, {} as never)
    const note = (mgr as unknown as {
      noteRejected: (h: string, p: number, fp: string) => void
    }).noteRejected.bind(mgr)
    note(H, 22, 'aaa')
    note(H, 22, 'bbb')

    expect(mgr.matchesRejectedKey(H, 22, 'aaa')).toBe(true)
    expect(mgr.matchesRejectedKey(H, 22, 'bbb')).toBe(true)
    // Consuming one must not consume the other.
    expect(mgr.takeRejectedKey(H, 22, 'aaa')).toBe(true)
    expect(mgr.takeRejectedKey(H, 22, 'aaa')).toBe(false)
    expect(mgr.takeRejectedKey(H, 22, 'bbb')).toBe(true)
  })
})
