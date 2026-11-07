/**
 * Local helpers for X11 forwarding (the client half of `ssh -X`).
 *
 * Why cookie rewriting exists: sshd writes a *pseudo* cookie into the remote
 * user's ~/.Xauthority, so every remote GUI app authenticates to the forwarded
 * DISPLAY with that pseudo cookie. The real local X server has never heard of
 * it. Before the hello reaches the local server, the client must swap in the
 * machine's own MIT-MAGIC-COOKIE-1 — exactly what OpenSSH's clientloop.c does.
 * Without this, only X servers launched with `-ac` (access control off) work.
 *
 * Everything here is local and pure, so it can be unit-tested offline.
 */
import { readFile } from 'node:fs/promises'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'

/** True for an address a *local* X server can be reached on. A remote DISPLAY
 *  (`otherhost:0`) must not trigger a local spawn, and its cookie must not be
 *  replaced with this machine's. */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase()
  return h === '' || h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]'
}

/** Where the local X server listens. $DISPLAY (`:1`, `:10.0`, `host:2`) picks
 *  the display; X servers on Windows (VcXsrv/Xming) listen on 6000 + N. */
export function localX11Target(env: NodeJS.ProcessEnv = process.env): { host: string; port: number; display: string } {
  const raw = (env.DISPLAY || '').trim()
  let host = '127.0.0.1'
  let display = '0'
  const m = raw ? /^(?:([^:]*):)?(\d+)(?:\.\d+)*$/.exec(raw) : null
  if (m) {
    if (m[1] && m[1] !== 'localhost' && m[1] !== 'unix') host = m[1]
    display = m[2]
  }
  return { host, port: 6000 + Number(display), display }
}

/** X11 ConnectionSetupRequest, the first packet of every X client connection:
 *
 *  0   byte-order ('B' = big-endian, 'l' = little-endian)
 *  1   unused
 *  2   protocol-major-version   CARD16
 *  4   protocol-minor-version   CARD16
 *  6   authorization-name-len   CARD16
 *  8   authorization-data-len   CARD16
 *  10  unused                  CARD16
 *  12  authorization-name      STRING8, padded to a multiple of 4
 *  ..  authorization-data      STRING8, padded to a multiple of 4
 */
export interface X11Hello {
  nameOffset: number
  nameLen: number
  /** Byte offset of the authorization-protocol-data (the cookie). */
  dataOffset: number
  dataLen: number
  /** Bytes needed before the whole hello (incl. cookie) is present. */
  needed: number
}

const pad4 = (n: number): number => (4 - (n % 4)) % 4

/** Parse a *possibly partial* hello. Null means: not a recognizable header
 *  yet, byte-order marker invalid, or absurd lengths (garbage/attack). In all
 *  of those cases the caller forwards the stream untouched rather than
 *  buffering forever. */
export function parseX11Hello(buf: Buffer): X11Hello | null {
  if (buf.length < 12) return null
  const be = buf[0] === 0x42
  const le = buf[0] === 0x6c
  if (!be && !le) return null
  const rd16 = (o: number): number => (be ? buf.readUInt16BE(o) : buf.readUInt16LE(o))
  const nameLen = rd16(6)
  const dataLen = rd16(8)
  if (nameLen > 256 || dataLen > 4096) return null
  const nameOffset = 12
  const dataOffset = nameOffset + nameLen + pad4(nameLen)
  return { nameOffset, nameLen, dataOffset, dataLen, needed: dataOffset + dataLen }
}

/** Swap the pseudo cookie for the local one. `buf` must hold at least the
 *  whole hello (parseX11Hello(...).needed bytes). Anything else — no auth,
 *  another protocol, unusual lengths — is returned byte-for-byte unchanged.
 *  When `expected` is given, only a hello carrying *our* pseudo cookie is
 *  rewritten (OpenSSH does the same check); a foreign cookie is left alone
 *  so the local X server can reject it normally. */
export function rewriteX11Hello(buf: Buffer, cookie: Buffer | undefined, expected?: Buffer): Buffer {
  if (!cookie || cookie.length !== 16) return buf
  const h = parseX11Hello(buf)
  if (!h || buf.length < h.needed || h.dataLen !== 16) return buf
  if (buf.toString('latin1', h.nameOffset, h.nameOffset + h.nameLen) !== 'MIT-MAGIC-COOKIE-1') return buf
  if (expected && !buf.subarray(h.dataOffset, h.dataOffset + 16).equals(expected)) return buf
  const out = Buffer.from(buf)
  cookie.copy(out, h.dataOffset, 0, 16)
  return out
}

interface XAuthEntry {
  family: number
  address: string
  display: string
  name: string
  data: Buffer
}

/**
 * Parse an xauth file (~/.Xauthority): a 16-bit family followed by four
 * 16-bit-length-prefixed fields (address, display, name, data), repeated.
 * Length words use the producing machine's byte order and files get copied
 * between machines, so try little- then big-endian and keep the interpretation
 * that parses the whole file cleanly.
 */
export function parseXauthority(buf: Buffer): XAuthEntry[] | null {
  for (const le of [true, false]) {
    const out = tryParseXauthority(buf, le)
    if (out) return out
  }
  return null
}

function tryParseXauthority(buf: Buffer, le: boolean): XAuthEntry[] | null {
  const entries: XAuthEntry[] = []
  let o = 0
  const u16 = (): number | null => {
    if (o + 2 > buf.length) return null
    const v = le ? buf.readUInt16LE(o) : buf.readUInt16BE(o)
    o += 2
    return v
  }
  const field = (): Buffer | null => {
    const n = u16()
    if (n === null || o + n > buf.length) return null
    const v = buf.subarray(o, o + n)
    o += n
    return v
  }
  while (o < buf.length) {
    const family = u16()
    if (family === null) return null
    const addr = field()
    const display = field()
    const name = field()
    const data = field()
    if (!addr || !display || !name || !data) return null
    entries.push({
      family,
      address: addr.toString('latin1'),
      display: display.toString('latin1'),
      name: name.toString('latin1'),
      data
    })
  }
  return entries
}

/**
 * The local MIT-MAGIC-COOKIE-1 for `display`, from $XAUTHORITY or
 * ~/.Xauthority. Accepts entries an X server would accept from a loopback
 * peer: FamilyWild(65535), FamilyLocal(256) for this host, FamilyInternet(2)
 * for 127.0.0.1; any other Internet entry is a last-resort fallback.
 * Returns undefined when there is no file or no usable entry — the caller
 * then pipes the hello untouched, which is correct for `-ac` servers such as
 * VcXsrv's default XLaunch profile.
 */
export async function readLocalX11Cookie(
  display: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<Buffer | undefined> {
  const path = env.XAUTHORITY || join(homedir(), '.Xauthority')
  let raw: Buffer
  try {
    raw = await readFile(path)
  } catch {
    return undefined
  }
  const entries = parseXauthority(raw)
  if (!entries) return undefined
  const host = hostname().toLowerCase()
  let fallback: Buffer | undefined
  for (const e of entries) {
    if (e.name !== 'MIT-MAGIC-COOKIE-1' || e.data.length !== 16 || e.display !== display) continue
    const exact =
      e.family === 65535 ||
      (e.family === 256 && e.address.toLowerCase() === host) ||
      (e.family === 2 && e.address === '127.0.0.1')
    if (exact) return e.data
    if (e.family === 2 && /^\d{1,3}(\.\d{1,3}){3}$/.test(e.address)) fallback = e.data
  }
  return fallback
}
