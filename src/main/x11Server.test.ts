import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:net'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { AddressInfo } from 'node:net'
import {
  ensureLocalXServer,
  ensureXauthority,
  findXServer,
  probeTcp,
  resetXServerState,
  xServerCandidates
} from './x11Server'
import { parseXauthority } from './x11'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'xssh-x11srv-'))
  resetXServerState()
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function listening(): Promise<{ port: number; close: () => Promise<void> }> {
  const s = createServer()
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()))
  return {
    port: (s.address() as AddressInfo).port,
    close: () => new Promise<void>((r) => s.close(() => r()))
  }
}

describe('xServerCandidates', () => {
  it('puts the user-scoped noadmin install first and de-duplicates', () => {
    const env = {
      LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)'
    }
    const list = xServerCandidates(env)
    expect(list[0]).toBe(join(env.LOCALAPPDATA, 'Programs', 'VcXsrv', 'vcxsrv.exe'))
    expect(list).toContain('C:\\Program Files\\VcXsrv\\vcxsrv.exe')
    expect(new Set(list).size).toBe(list.length)
  })

  it('still offers the hardcoded fallbacks when env is empty', () => {
    expect(xServerCandidates({})).toEqual([
      'C:\\Program Files\\VcXsrv\\vcxsrv.exe',
      'C:\\Program Files (x86)\\VcXsrv\\vcxsrv.exe'
    ])
  })

  it.skipIf(process.platform !== 'win32')('findXServer returns the first existing exe', async () => {
    const fake = join(dir, 'Programs', 'VcXsrv', 'vcxsrv.exe')
    await mkdir(dirname(fake), { recursive: true })
    await writeFile(fake, '')
    expect(findXServer({ LOCALAPPDATA: dir })).toBe(fake)
  })

  it.skipIf(process.platform !== 'win32')('XSSH_X11_AUTOSTART=0 leaves lifecycle to the user', async () => {
    const fake = join(dir, 'Programs', 'VcXsrv', 'vcxsrv.exe')
    await mkdir(dirname(fake), { recursive: true })
    await writeFile(fake, '')
    expect(findXServer({ LOCALAPPDATA: dir, XSSH_X11_AUTOSTART: '0' })).toBeUndefined()
  })
})

describe('probeTcp / ensureLocalXServer', () => {
  it('detects a live listener and a dead port', async () => {
    const s = await listening()
    expect(await probeTcp('127.0.0.1', s.port)).toBe(true)
    await s.close()
    expect(await probeTcp('127.0.0.1', s.port)).toBe(false)
  })

  it('reuses an already running X server without spawning anything', async () => {
    const s = await listening()
    try {
      const result = await ensureLocalXServer({
        host: '127.0.0.1',
        port: s.port,
        display: '0',
        timeoutMs: 50
      })
      expect(result).toBe('ready')
    } finally {
      await s.close()
    }
  })
})

describe('ensureXauthority', () => {
  it('writes one parseable FamilyWild MIT-MAGIC-COOKIE-1 entry', async () => {
    const p = join(dir, 'Xauthority')
    expect(await ensureXauthority('0', { XAUTHORITY: p })).toBe(p)
    const entries = parseXauthority(await readFile(p))
    expect(entries).toHaveLength(1)
    expect(entries![0]).toMatchObject({
      family: 65535,
      address: '',
      display: '0',
      name: 'MIT-MAGIC-COOKIE-1'
    })
    expect(entries![0].data).toHaveLength(16)
  })

  it('keeps the requested display number', async () => {
    const p = join(dir, 'Xauthority10')
    await ensureXauthority('10', { XAUTHORITY: p })
    expect(parseXauthority(await readFile(p))![0].display).toBe('10')
  })

  it('leaves an existing file that already serves this display untouched', async () => {
    const p = join(dir, 'Xauthority')
    const original = xauthFixture('0', Buffer.alloc(16, 7))
    await writeFile(p, original)
    expect(await ensureXauthority('0', { XAUTHORITY: p })).toBe(p)
    expect((await readFile(p)).equals(original)).toBe(true)
  })

  it('appends an entry when the existing file has no cookie for this display', async () => {
    const p = join(dir, 'Xauthority')
    const original = xauthFixture('0', Buffer.alloc(16, 7))
    await writeFile(p, original)
    expect(await ensureXauthority('10', { XAUTHORITY: p })).toBe(p)
    const entries = parseXauthority(await readFile(p))
    expect(entries).toHaveLength(2)
    expect(entries!.map((e) => e.display)).toEqual(['0', '10'])
    // The other tool's entry is still there, byte for byte.
    expect((await readFile(p)).subarray(0, original.length).equals(original)).toBe(true)
    // And the new display now has a real cookie the client can rewrite to.
    const { readLocalX11Cookie } = await import('./x11')
    expect(await readLocalX11Cookie('10', { XAUTHORITY: p })).toHaveLength(16)
  })

  it('does not hand a non-xauth file to the X server as -auth', async () => {
    const p = join(dir, 'existing')
    await writeFile(p, 'keep me')
    expect(await ensureXauthority('0', { XAUTHORITY: p })).toBeUndefined()
    expect(await readFile(p, 'utf8')).toBe('keep me')
  })
})

/** Minimal FamilyWild xauth entry, mirroring the real file format. */
function xauthFixture(display: string, cookie: Buffer): Buffer {
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
    field('MIT-MAGIC-COOKIE-1'),
    field(cookie)
  ])
}
