import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createServer, type AddressInfo, type Socket } from 'node:net'
import { Server, utils } from 'ssh2'
import type { ConnectParams } from '../shared/types'

let dir = ''
vi.mock('electron', () => ({ app: { getPath: () => dir } }))

const { SshManager } = await import('./ssh')
const { KnownHosts } = await import('./knownHosts')
const { IPC } = await import('../shared/ipc')

const H = '127.0.0.1'
const hostKey = utils.generateKeyPairSync('ed25519')
const realFp = createHash('sha256')
  .update((utils.parseKey(hostKey.private) as { getPublicSSH(): Buffer }).getPublicSSH())
  .digest('hex')

/** The locally installed MIT-MAGIC-COOKIE-1 (what VcXsrv expects). */
const LOCAL_COOKIE = Buffer.alloc(16, 0x5c)

function xauthEntry(cookie: Buffer, display: string): Buffer {
  const u16 = (v: number): Buffer => {
    const b = Buffer.alloc(2)
    b.writeUInt16LE(v)
    return b
  }
  const field = (v: Buffer | string): Buffer => {
    const s = Buffer.isBuffer(v) ? v : Buffer.from(v, 'latin1')
    return Buffer.concat([u16(s.length), s])
  }
  // FamilyWild matches any display host; the display number must match $DISPLAY.
  return Buffer.concat([
    u16(65535),
    field(''),
    field(display),
    field('MIT-MAGIC-COOKIE-1'),
    field(cookie)
  ])
}

/** A real X11 ConnectionSetupRequest carrying the sshd-issued pseudo cookie. */
function x11Hello(pseudoHex: string, be = true): Buffer {
  const name = Buffer.from('MIT-MAGIC-COOKIE-1', 'latin1')
  const data = Buffer.from(pseudoHex, 'hex')
  const u16 = (v: number): Buffer => {
    const b = Buffer.alloc(2)
    be ? b.writeUInt16BE(v) : b.writeUInt16LE(v)
    return b
  }
  return Buffer.concat([
    Buffer.from([be ? 0x42 : 0x6c, 0]),
    u16(11), u16(0),
    u16(name.length), u16(data.length),
    Buffer.alloc(2),
    name, Buffer.alloc((4 - (name.length % 4)) % 4),
    data, Buffer.alloc((4 - (data.length % 4)) % 4)
  ])
}

interface X11Request {
  /** ssh2 hands back a Buffer holding the ASCII hex cookie. */
  cookie: Buffer | string
  protocol: string
  single: boolean
}

const cookieHex = (v: Buffer | string): string =>
  (Buffer.isBuffer(v) ? v.toString('latin1') : v)

/** Fake sshd. `acceptX11` controls whether x11-req is granted. `sendHello`
 *  pushes a forwarded X11 connection at the client once the shell is up. */
function makeSshd(opts: { acceptX11: boolean; sendHello: boolean }) {
  const state: { requests: X11Request[]; shells: number; hello?: Buffer } = { requests: [], shells: 0 }
  const server = new Server({ hostKeys: [hostKey.private] }, (client) => {
    client.on('authentication', (ctx) => {
      const ok = ctx.method === 'password' && ctx.username === 'u' && ctx.password === 'p'
      ;(ok ? ctx.accept() : ctx.reject(['password'])) as unknown
    })
    client.on('ready', () => {
      client.on('session', (accept) => {
        const sess = accept()
        sess.on('pty', (a) => a())
        sess.on('exec', (a) => a().end())
        // ssh2 server emits (accept, reject, info) for x11-req.
        const raw = sess as unknown as {
          on: (
            ev: 'x11',
            fn: (a: () => void, r: () => void, info: X11Request) => void
          ) => void
        }
        raw.on('x11', (a, r, info) => {
          state.requests.push(info)
          state.hello = x11Hello(cookieHex(info.cookie))
          if (opts.acceptX11) a()
          else r()
        })
        sess.on('shell', (a) => {
          state.shells++
          a().write('$ ')
          if (opts.sendHello && opts.acceptX11) {
            // sshd-side: a remote X client connected to the forwarded DISPLAY.
            // `x11()` lives on the server-side Client, not on Session.
            const open = client as unknown as {
              x11: (addr: string, port: number, cb: (err: Error | undefined, ch: import('node:stream').Duplex) => void) => void
            }
            setTimeout(() => {
              open.x11(H, 6010, (err, ch) => {
                if (!err) ch.write(state.hello!)
              })
            }, 30)
          }
        })
      })
    })
    client.on('error', () => undefined)
  })
  return { server, state }
}

let port = 0
let xPort = 0
let xServer: ReturnType<typeof createServer> | undefined
/** Bytes the fake local X server received, per connection. */
let xReceived: Buffer[] = []
let savedDisplay: string | undefined
let savedXauth: string | undefined
let savedAutostart: string | undefined
let dirCreated = ''

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'xssh-x11-'))
  dirCreated = dir
  // These tests stand in for the local X server with a socket; never let the
  // auto-start helper launch a real VcXsrv on the developer's machine.
  savedAutostart = process.env.XSSH_X11_AUTOSTART
  process.env.XSSH_X11_AUTOSTART = '0'
})

afterAll(async () => {
  if (savedAutostart === undefined) delete process.env.XSSH_X11_AUTOSTART
  else process.env.XSSH_X11_AUTOSTART = savedAutostart
  await rm(dirCreated, { recursive: true, force: true })
})

afterEach(async () => {
  xServer?.close()
  xServer = undefined
  xReceived = []
  if (savedDisplay === undefined) delete process.env.DISPLAY
  else process.env.DISPLAY = savedDisplay
  if (savedXauth === undefined) delete process.env.XAUTHORITY
  else process.env.XAUTHORITY = savedXauth
  savedDisplay = undefined
  savedXauth = undefined
  vi.restoreAllMocks()
})

/** Starts a fake local X server and points $DISPLAY + $XAUTHORITY at it. */
async function startLocalX(withCookie: boolean): Promise<void> {
  savedDisplay = process.env.DISPLAY
  savedXauth = process.env.XAUTHORITY
  const s = createServer((sock: Socket) => {
    const chunks: Buffer[] = []
    sock.on('data', (d: Buffer) => {
      chunks.push(d)
      xReceived.push(Buffer.concat(chunks))
    })
    sock.on('error', () => undefined)
  })
  await new Promise<void>((r) => s.listen(0, H, () => r()))
  xPort = (s.address() as AddressInfo).port
  xServer = s
  const display = String(xPort - 6000)
  process.env.DISPLAY = `:${display}`
  delete process.env.XAUTHORITY
  if (withCookie) {
    // The X server listens on a random port, so the cookie entry must carry
    // the same display number as $DISPLAY.
    const authPath = join(dirCreated, 'Xauthority')
    await writeFile(authPath, xauthEntry(LOCAL_COOKIE, display))
    process.env.XAUTHORITY = authPath
  }
}

async function startSshd(opts: { acceptX11: boolean; sendHello: boolean }) {
  const { server, state } = makeSshd(opts)
  await new Promise<void>((r) => server.listen(0, H, () => r()))
  port = (server.address() as AddressInfo).port
  return { server, state }
}

const sender = { isDestroyed: () => false, send: vi.fn() }

async function knownHosts(): Promise<InstanceType<typeof KnownHosts>> {
  const kh = new KnownHosts()
  await kh.load()
  const m = (kh as unknown as { map: Record<string, { fps: string[]; firstSeen?: number }> }).map
  m[KnownHosts.key(H, port)] = { fps: [realFp], firstSeen: 0 }
  return kh
}

const notices = (): string[] =>
  sender.send.mock.calls
    .filter((c: unknown[]) => c[0] === IPC.sshEvent)
    .map((c: unknown[]) => (c[1] as { notice?: string }).notice)
    .filter((n): n is string => !!n)

describe('SshManager X11 forwarding (-X)', () => {
  it('asks for X11 only when the host enables it', async () => {
    await startLocalX(true)
    const { server, state } = await startSshd({ acceptX11: true, sendHello: false })
    try {
      const kh = await knownHosts()
      const off = new SshManager(sender as never, kh)
      const a = await off.connect({ host: H, port, username: 'u', auth: 'password', password: 'p' } as ConnectParams)
      expect(a.ok).toBe(true)
      expect(state.requests).toHaveLength(0)
      await off.disconnect(a.sessionId!)

      const on = new SshManager(sender as never, await knownHosts())
      const b = await on.connect({ host: H, port, username: 'u', auth: 'password', password: 'p', x11Forward: true } as ConnectParams)
      expect(b.ok).toBe(true)
      expect(state.requests).toHaveLength(1)
      expect(state.requests[0].protocol).toBe('MIT-MAGIC-COOKIE-1')
      expect(cookieHex(state.requests[0].cookie)).toMatch(/^[0-9a-f]{32}$/)
      await on.disconnect(b.sessionId!)
    } finally {
      server.close()
    }
  })

  it('pipes a forwarded X11 connection and swaps the pseudo cookie for the local one', async () => {
    await startLocalX(true)
    const { server, state } = await startSshd({ acceptX11: true, sendHello: true })
    try {
      const mgr = new SshManager(sender as never, await knownHosts())
      const res = await mgr.connect({ host: H, port, username: 'u', auth: 'password', password: 'p', x11Forward: true } as ConnectParams)
      expect(res.ok).toBe(true)
      const deadline = Date.now() + 3000
      while (!xReceived.length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20))
      expect(xReceived.length, 'the local X server never received the hello').toBeGreaterThan(0)
      const got = xReceived[xReceived.length - 1]
      expect(got.length).toBeGreaterThanOrEqual(48)
      // Byte 32..48 is the authorization data: it must be the LOCAL cookie,
      // never the pseudo cookie sshd issued to the remote ~/.Xauthority.
      expect(got.subarray(32, 48).equals(LOCAL_COOKIE)).toBe(true)
      expect(got.subarray(32, 48).equals(Buffer.from(cookieHex(state.requests[0].cookie), 'hex'))).toBe(false)
      await mgr.disconnect(res.sessionId!)
    } finally {
      server.close()
    }
  })

  it('degrades to a plain shell when sshd refuses the X11 request', async () => {
    await startLocalX(true)
    const { server, state } = await startSshd({ acceptX11: false, sendHello: false })
    try {
      const mgr = new SshManager(sender as never, await knownHosts())
      const res = await mgr.connect({ host: H, port, username: 'u', auth: 'password', password: 'p', x11Forward: true } as ConnectParams)
      expect(res, JSON.stringify(res)).toMatchObject({ ok: true })
      // One refused request, then a second shell opened without X11.
      expect(state.requests).toHaveLength(1)
      expect(state.shells).toBe(1)
      expect(notices()).toContain('x11-refused')
      await mgr.disconnect(res.sessionId!)
    } finally {
      server.close()
    }
  })

  it('reports a missing local X server once instead of hanging the paste', async () => {
    // No X server listening: DISPLAY points at a closed port.
    savedDisplay = process.env.DISPLAY
    savedXauth = process.env.XAUTHORITY
    process.env.DISPLAY = ':0'
    delete process.env.XAUTHORITY
    const dead = createServer()
    await new Promise<void>((r) => dead.listen(0, H, () => r()))
    const deadPort = (dead.address() as AddressInfo).port
    await new Promise<void>((r) => dead.close(() => r()))
    process.env.DISPLAY = `:${deadPort - 6000}`

    const { server } = await startSshd({ acceptX11: true, sendHello: true })
    try {
      const mgr = new SshManager(sender as never, await knownHosts())
      const res = await mgr.connect({ host: H, port, username: 'u', auth: 'password', password: 'p', x11Forward: true } as ConnectParams)
      expect(res.ok).toBe(true)
      const deadline = Date.now() + 3000
      while (!notices().includes('x11-no-server') && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 20))
      }
      expect(notices()).toContain('x11-no-server')
      await mgr.disconnect(res.sessionId!)
    } finally {
      server.close()
    }
  })
})
