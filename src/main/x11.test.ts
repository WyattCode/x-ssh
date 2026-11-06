import { describe, it, expect } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  localX11Target,
  parseX11Hello,
  parseXauthority,
  readLocalX11Cookie,
  rewriteX11Hello
} from './x11'

/** A real ConnectionSetupRequest: MIT-MAGIC-COOKIE-1, 16-byte cookie, 11/0. */
function hello(opts: { be?: boolean; name?: string; data?: Buffer; major?: number } = {}): Buffer {
  const be = opts.be ?? true
  const name = Buffer.from(opts.name ?? 'MIT-MAGIC-COOKIE-1', 'latin1')
  const data = opts.data ?? Buffer.alloc(16, 0xab)
  const u16 = (v: number): Buffer => {
    const b = Buffer.alloc(2)
    be ? b.writeUInt16BE(v) : b.writeUInt16LE(v)
    return b
  }
  const namePad = Buffer.alloc((4 - (name.length % 4)) % 4)
  const dataPad = Buffer.alloc((4 - (data.length % 4)) % 4)
  return Buffer.concat([
    Buffer.from([be ? 0x42 : 0x6c, 0]),
    u16(opts.major ?? 11),
    u16(0),
    u16(name.length),
    u16(data.length),
    Buffer.alloc(2),
    name,
    namePad,
    data,
    dataPad
  ])
}

/** One xauth entry: family + 4 length-prefixed fields. */
function xauthEntry(
  family: number,
  address: string,
  display: string,
  name: string,
  data: Buffer,
  be = false
): Buffer {
  const u16 = (v: number): Buffer => {
    const b = Buffer.alloc(2)
    be ? b.writeUInt16BE(v) : b.writeUInt16LE(v)
    return b
  }
  const field = (v: Buffer | string): Buffer => {
    const s = Buffer.isBuffer(v) ? v : Buffer.from(v, 'latin1')
    return Buffer.concat([u16(s.length), s])
  }
  return Buffer.concat([
    u16(family),
    field(address),
    field(display),
    field(name),
    field(data)
  ])
}

describe('localX11Target', () => {
  it('defaults to display 0 on loopback when DISPLAY is unset', () => {
    expect(localX11Target({})).toEqual({ host: '127.0.0.1', port: 6000, display: '0' })
  })
  it('reads the display number from :10.0', () => {
    expect(localX11Target({ DISPLAY: ':10.0' })).toEqual({ host: '127.0.0.1', port: 6010, display: '10' })
  })
  it('treats localhost and unix as loopback hosts', () => {
    expect(localX11Target({ DISPLAY: 'localhost:1' }).port).toBe(6001)
    expect(localX11Target({ DISPLAY: 'unix:2.0' }).host).toBe('127.0.0.1')
  })
  it('honors a remote display host', () => {
    expect(localX11Target({ DISPLAY: '10.0.0.5:3.0' })).toEqual({
      host: '10.0.0.5',
      port: 6003,
      display: '3'
    })
  })
  it('ignores malformed DISPLAY instead of computing NaN', () => {
    expect(localX11Target({ DISPLAY: 'garbage' }).port).toBe(6000)
  })
})

describe('parseX11Hello', () => {
  it('parses a big-endian hello: 12-byte header, padded name, cookie at 32', () => {
    const buf = hello()
    const h = parseX11Hello(buf)
    expect(h).not.toBeNull()
    expect(h!.nameOffset).toBe(12)
    expect(h!.nameLen).toBe(18)
    expect(h!.dataOffset).toBe(32)
    expect(h!.dataLen).toBe(16)
    expect(h!.needed).toBe(48)
    expect(buf.length).toBe(48)
  })
  it('parses a little-endian hello with the same offsets', () => {
    const h = parseX11Hello(hello({ be: false }))
    expect(h!.dataOffset).toBe(32)
    expect(h!.needed).toBe(48)
  })
  it('waits for the full 12-byte header', () => {
    expect(parseX11Hello(hello().subarray(0, 11))).toBeNull()
  })
  it('rejects an invalid byte-order marker', () => {
    const buf = hello()
    buf[0] = 0x58
    expect(parseX11Hello(buf)).toBeNull()
  })
  it('rejects absurd field lengths instead of buffering forever', () => {
    const buf = hello()
    buf.writeUInt16BE(60000, 6)
    expect(parseX11Hello(buf)).toBeNull()
  })
  it('reports needed even when the packet is only partly arrived', () => {
    const h = parseX11Hello(hello().subarray(0, 20))
    expect(h!.needed).toBe(48) // caller keeps buffering until this many bytes
  })
})

describe('rewriteX11Hello', () => {
  const local = Buffer.alloc(16, 0x5c)
  const pseudo = Buffer.alloc(16, 0xab)

  it('swaps the pseudo cookie for the local one at the correct offset', () => {
    const out = rewriteX11Hello(hello({ data: pseudo }), local, pseudo)
    expect(out.subarray(32, 48).equals(local)).toBe(true)
    expect(out.length).toBe(48)
    // everything except the 16 cookie bytes is byte-identical
    expect(out.subarray(0, 32).equals(hello({ data: pseudo }).subarray(0, 32))).toBe(true)
  })
  it('does not touch a foreign cookie', () => {
    const foreign = hello({ data: Buffer.alloc(16, 0x11) })
    expect(rewriteX11Hello(foreign, local, pseudo).equals(foreign)).toBe(true)
  })
  it('works without the expected-cookie check', () => {
    const out = rewriteX11Hello(hello({ data: pseudo }), local)
    expect(out.subarray(32, 48).equals(local)).toBe(true)
  })
  it('leaves other auth protocols and no-auth hellos untouched', () => {
    const other = hello({ name: 'XDM-AUTHORIZATION-1' })
    expect(rewriteX11Hello(other, local, pseudo).equals(other)).toBe(true)
    const none = hello({ name: '', data: Buffer.alloc(0) })
    expect(rewriteX11Hello(none, local, pseudo).equals(none)).toBe(true)
  })
  it('leaves everything alone when no local cookie exists (-ac servers)', () => {
    const buf = hello({ data: pseudo })
    expect(rewriteX11Hello(buf, undefined, pseudo).equals(buf)).toBe(true)
  })
  it('never writes past the buffer on a truncated hello', () => {
    const short = hello({ data: pseudo }).subarray(0, 40)
    expect(rewriteX11Hello(short, local, pseudo).equals(short)).toBe(true)
  })
  it('preserves trailing bytes after the hello', () => {
    const buf = Buffer.concat([hello({ data: pseudo }), Buffer.from('NEXT-REQUEST')])
    const out = rewriteX11Hello(buf.subarray(0, 48), local, pseudo)
    expect(out.subarray(32, 48).equals(local)).toBe(true)
    expect(buf.subarray(48).toString()).toBe('NEXT-REQUEST')
  })
})

describe('parseXauthority', () => {
  const cookie = Buffer.alloc(16, 0x77)

  it('parses little-endian entries', () => {
    const buf = xauthEntry(2, '127.0.0.1', '0', 'MIT-MAGIC-COOKIE-1', cookie, false)
    const entries = parseXauthority(buf)!
    expect(entries).toHaveLength(1)
    expect(entries[0].family).toBe(2)
    expect(entries[0].address).toBe('127.0.0.1')
    expect(entries[0].display).toBe('0')
    expect(entries[0].name).toBe('MIT-MAGIC-COOKIE-1')
    expect(entries[0].data.equals(cookie)).toBe(true)
  })
  it('parses big-endian entries too (files get copied between machines)', () => {
    const buf = xauthEntry(65535, '', '0', 'MIT-MAGIC-COOKIE-1', cookie, true)
    expect(parseXauthority(buf)![0].family).toBe(65535)
  })
  it('parses several entries in one file', () => {
    const buf = Buffer.concat([
      xauthEntry(2, '127.0.0.1', '0', 'MIT-MAGIC-COOKIE-1', cookie),
      xauthEntry(256, 'other-host', '1', 'MIT-MAGIC-COOKIE-1', cookie)
    ])
    expect(parseXauthority(buf)).toHaveLength(2)
  })
  it('returns null for a truncated file', () => {
    const buf = xauthEntry(2, '127.0.0.1', '0', 'MIT-MAGIC-COOKIE-1', cookie)
    expect(parseXauthority(buf.subarray(0, buf.length - 5))).toBeNull()
  })
})

describe('readLocalX11Cookie', () => {
  const cookie = Buffer.alloc(16, 0x33)

  it('returns the loopback entry for the requested display', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'xssh-xauth-'))
    try {
      const path = join(dir, '.Xauthority')
      await writeFile(path, xauthEntry(2, '127.0.0.1', '0', 'MIT-MAGIC-COOKIE-1', cookie))
      expect((await readLocalX11Cookie('0', { XAUTHORITY: path }))!.equals(cookie)).toBe(true)
      expect(await readLocalX11Cookie('10', { XAUTHORITY: path })).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
  it('prefers an exact loopback match over another host entry', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'xssh-xauth-'))
    try {
      const path = join(dir, '.Xauthority')
      const other = Buffer.alloc(16, 0x99)
      await writeFile(path, Buffer.concat([
        xauthEntry(2, '10.0.0.7', '0', 'MIT-MAGIC-COOKIE-1', other),
        xauthEntry(2, '127.0.0.1', '0', 'MIT-MAGIC-COOKIE-1', cookie)
      ]))
      expect((await readLocalX11Cookie('0', { XAUTHORITY: path }))!.equals(cookie)).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
  it('returns undefined when the file is missing (typical on Windows)', async () => {
    expect(await readLocalX11Cookie('0', { XAUTHORITY: join(tmpdir(), 'xssh-no-such-xauth') })).toBeUndefined()
  })
  it('ignores entries with a non-cookie protocol', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'xssh-xauth-'))
    try {
      const path = join(dir, '.Xauthority')
      await writeFile(path, xauthEntry(2, '127.0.0.1', '0', 'XDM-AUTHORIZATION-1', cookie))
      expect(await readLocalX11Cookie('0', { XAUTHORITY: path })).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
