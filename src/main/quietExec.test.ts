import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createServer, type AddressInfo } from 'node:net'
import { Server, utils } from 'ssh2'
import { OS_PROBE_COMMAND, parseOsProbe } from '../shared/hostOs'
import type { ConnectParams } from '../shared/types'

let dir = ''
vi.mock('electron', () => ({ app: { getPath: () => dir } }))

const { SshManager } = await import('./ssh')
const { KnownHosts } = await import('./knownHosts')

// A throwaway sshd on localhost: password u / p, answers any exec with an
// Ubuntu os-release. Records what it was asked to run and whether a shell or
// pty was ever requested (the background probe must never ask for one).
const hostKey = utils.generateKeyPairSync('ed25519')
const fingerprint = createHash('sha256')
  .update((utils.parseKey(hostKey.private) as { getPublicSSH(): Buffer }).getPublicSSH())
  .digest('hex')
const seen = { exec: [] as string[], shell: 0, logins: 0 }
let server: Server
let port = 0

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'xssh-quiet-'))
  server = new Server({ hostKeys: [hostKey.private] }, (client) => {
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.username === 'u' && ctx.password === 'p') {
        seen.logins++
        ctx.accept()
      } else ctx.reject(['password'])
    })
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept()
        session.on('pty', () => seen.shell++)
        session.on('shell', () => seen.shell++)
        session.on('exec', (acceptExec, _reject, info) => {
          seen.exec.push(info.command)
          const stream = acceptExec()
          stream.write('NAME="Ubuntu"\nID=ubuntu\nPRETTY_NAME="Ubuntu 26.04 LTS"\nXSSH_UNAME=Linux\n')
          stream.exit(0)
          stream.end()
        })
      })
    })
    client.on('error', () => undefined)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  port = (server.address() as AddressInfo).port
})

afterAll(async () => {
  server.close()
  await rm(dir, { recursive: true, force: true })
})

const sender = { isDestroyed: () => false, send: vi.fn() }
const params = (over: Partial<ConnectParams> = {}): ConnectParams =>
  ({ host: '127.0.0.1', port, username: 'u', auth: 'password', password: 'p', ...over }) as ConnectParams

describe('SshManager.quietExec (background OS detection)', () => {
  it('logs in without a terminal, runs the probe and reads the OS', async () => {
    const kh = new KnownHosts()
    await kh.load()
    await kh.set('127.0.0.1', port, fingerprint)
    const mgr = new SshManager(sender as never, kh)
    const out = await mgr.quietExec(params(), OS_PROBE_COMMAND)
    expect(parseOsProbe(out)).toEqual({ id: 'ubuntu', pretty: 'Ubuntu 26.04 LTS' })
    expect(seen.exec).toEqual([OS_PROBE_COMMAND])
    expect(seen.shell).toBe(0)
    // Nothing reaches the renderer: no tab, no status events.
    expect(sender.send).not.toHaveBeenCalled()
  })

  it('never trusts a server whose host key is not on record', async () => {
    const kh = new KnownHosts()
    await kh.load()
    const logins = seen.logins
    const mgr = new SshManager(sender as never, kh)
    await expect(mgr.quietExec(params({ host: 'localhost' }), OS_PROBE_COMMAND)).rejects.toThrow(/not on record/)
    expect(seen.logins).toBe(logins)
    expect(kh.get('localhost', port)).toBeUndefined()
  })

  it('does not trust an unknown jump host either', async () => {
    const kh = new KnownHosts()
    await kh.load()
    await kh.set('127.0.0.1', port, fingerprint)
    const logins = seen.logins
    const mgr = new SshManager(sender as never, kh)
    const jump = { host: 'hop.invalid', port: 22, username: 'u', auth: 'password' as const, password: 'p' }
    await expect(mgr.quietExec(params({ jump }), OS_PROBE_COMMAND)).rejects.toThrow(/jump host key not on record/)
    expect(seen.logins).toBe(logins)
    expect(kh.get('hop.invalid', 22)).toBeUndefined()
  })

  it('times out on a proxy that never answers, and closes it', async () => {
    const kh = new KnownHosts()
    await kh.load()
    await kh.set('127.0.0.1', port, fingerprint)
    // Accepts TCP, then says nothing — the handshake never completes.
    const opened: { closed: boolean }[] = []
    const silent = createServer((c) => {
      const rec = { closed: false }
      opened.push(rec)
      c.resume()
      c.on('close', () => (rec.closed = true))
    })
    await new Promise<void>((r) => silent.listen(0, '127.0.0.1', () => r()))
    const proxyPort = (silent.address() as AddressInfo).port
    const mgr = new SshManager(sender as never, kh)
    const t0 = Date.now()
    await expect(
      mgr.quietExec(params({ proxy: { type: 'socks5', host: '127.0.0.1', port: proxyPort } }), OS_PROBE_COMMAND, 400)
    ).rejects.toThrow(/timeout/)
    expect(Date.now() - t0).toBeLessThan(2000)
    await new Promise((r) => setTimeout(r, 150))
    expect(opened.length).toBe(1)
    expect(opened.every((c) => c.closed)).toBe(true)
    silent.close()
  })

  it('fails fast on a key it cannot read', async () => {
    const kh = new KnownHosts()
    await kh.load()
    await kh.set('127.0.0.1', port, fingerprint)
    const keyFile = join(dir, 'bad_key')
    await writeFile(keyFile, 'not a key')
    const mgr = new SshManager(sender as never, kh)
    const t0 = Date.now()
    await expect(mgr.quietExec(params({ auth: 'key', keyPath: keyFile, password: undefined }), OS_PROBE_COMMAND)).rejects.toThrow()
    expect(Date.now() - t0).toBeLessThan(2000)
  })

  it('aborts when the host key changed', async () => {
    const kh = new KnownHosts()
    await kh.load()
    // Earlier cases in this file may already have trusted the real fingerprint
    // for 127.0.0.1:port; set() now *adds*, so wipe first or the real key would
    // still be accepted alongside the stale one.
    await kh.forget('127.0.0.1', port)
    await kh.set('127.0.0.1', port, 'f'.repeat(64))
    const logins = seen.logins
    const mgr = new SshManager(sender as never, kh)
    await expect(mgr.quietExec(params(), OS_PROBE_COMMAND)).rejects.toThrow()
    expect(seen.logins).toBe(logins)
  })
})
