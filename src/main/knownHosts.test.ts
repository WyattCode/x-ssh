import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fpA = 'a'.repeat(64)
const fpB = 'b'.repeat(64)
const fpC = 'c'.repeat(64)

describe('KnownHosts multi-key trust', () => {
  let dir: string
  let KnownHosts: typeof import('./knownHosts').KnownHosts

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'xssh-kh-'))
    vi.resetModules()
    vi.doMock('electron', () => ({
      app: { getPath: () => dir }
    }))
    ;({ KnownHosts } = await import('./knownHosts'))
  })

  afterEach(async () => {
    vi.doUnmock('electron')
    await rm(dir, { recursive: true, force: true })
  })

  it('migrates a legacy bare-string record into fps[]', async () => {
    await writeFile(join(dir, 'known_hosts.json'), JSON.stringify({ 'h:22': fpA }), 'utf8')
    const kh = new KnownHosts()
    await kh.load()
    expect(kh.getAll('h', 22)).toEqual([fpA])
    expect(kh.get('h', 22)).toBe(fpA)
  })

  it('migrates the {fp} record form into fps[]', async () => {
    await writeFile(
      join(dir, 'known_hosts.json'),
      JSON.stringify({ 'h:22': { fp: fpA, firstSeen: 42 } }),
      'utf8'
    )
    const kh = new KnownHosts()
    await kh.load()
    expect(kh.getAll('h', 22)).toEqual([fpA])
    expect(kh.list()[0].firstSeen).toBe(42)
    expect(kh.list()[0].fingerprints).toEqual([fpA])
  })

  it('set() adds a second fingerprint without wiping the first', async () => {
    const kh = new KnownHosts()
    await kh.load()
    await kh.set('h', 22, fpA)
    await kh.set('h', 22, fpB)
    expect(kh.getAll('h', 22)).toEqual([fpA, fpB])
    expect(kh.accepts('h', 22, fpA)).toBe(true)
    expect(kh.accepts('h', 22, fpB)).toBe(true)
    expect(kh.accepts('h', 22, fpC)).toBe(false)
    // re-set same key is a no-op on membership
    await kh.set('h', 22, fpA.toUpperCase())
    expect(kh.getAll('h', 22)).toEqual([fpA, fpB])
  })

  it('accepts is case-insensitive on hex', async () => {
    const kh = new KnownHosts()
    await kh.load()
    await kh.set('h', 22, fpA)
    expect(kh.accepts('h', 22, fpA.toUpperCase())).toBe(true)
  })

  it('forget removes every key for the host', async () => {
    const kh = new KnownHosts()
    await kh.load()
    await kh.set('h', 22, fpA)
    await kh.set('h', 22, fpB)
    await kh.forget('h', 22)
    expect(kh.getAll('h', 22)).toEqual([])
    expect(kh.get('h', 22)).toBeUndefined()
  })

  it('importAll / list round-trip fingerprints[]', async () => {
    const kh = new KnownHosts()
    await kh.load()
    await kh.importAll([
      { host: 'a.example', port: 22, fingerprint: fpA, fingerprints: [fpA, fpB], firstSeen: 7 },
      { host: 'b.example', port: 2222, fingerprint: fpC }
    ])
    const list = kh.list()
    expect(list).toHaveLength(2)
    const a = list.find((e) => e.host === 'a.example')!
    expect(a.fingerprint).toBe(fpA)
    expect(a.fingerprints).toEqual([fpA, fpB])
    expect(a.firstSeen).toBe(7)
    expect(kh.accepts('b.example', 2222, fpC)).toBe(true)
  })

  it('persists fps across reload', async () => {
    const kh = new KnownHosts()
    await kh.load()
    await kh.set('h', 22, fpA)
    await kh.set('h', 22, fpB)
    vi.resetModules()
    vi.doMock('electron', () => ({ app: { getPath: () => dir } }))
    const { KnownHosts: KH2 } = await import('./knownHosts')
    const again = new KH2()
    await again.load()
    expect(again.getAll('h', 22)).toEqual([fpA, fpB])
  })
})

// ---- corrupt-file fail-closed ----
// A separate suite: these cases need the store to see a damaged file at load
// time, so each test re-imports the module against a fresh temp dir rather than
// reusing the suite above's long-lived instance.

/** A truncated JSON document: parses as neither the main file nor a backup. */
const CORRUPT = '{"a.example.com:22": {"fp": "aa'

describe('KnownHosts corrupt fail-closed', () => {
  let dir: string
  let KnownHosts: typeof import('./knownHosts').KnownHosts
  let KnownHostsCorruptError: typeof import('./knownHosts').KnownHostsCorruptError

  const file = (): string => join(dir, 'known_hosts.json')

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'xssh-known-'))
    // The mock must be registered before the import so the module sees the dir.
    vi.resetModules()
    vi.doMock('electron', () => ({ app: { getPath: () => dir } }))
    ;({ KnownHosts, KnownHostsCorruptError } = await import('./knownHosts'))
  })

  afterEach(async () => {
    vi.doUnmock('electron')
    await rm(dir, { recursive: true, force: true })
  })

  // 旧实现只在 map 为空时跳过写入:信任一台新主机就会把 {那一台} 写回去,
  // 其余已信任的指纹全部消失。现在损坏时任何写入都拒绝。
  it('refuses set() on a corrupt file and leaves the bytes untouched', async () => {
    await writeFile(file(), CORRUPT, 'utf8')
    const kh = new KnownHosts()
    await kh.load()
    expect(kh.status().loadFailed).toBe(true)
    await expect(kh.set('b.example.com', 22, 'bb')).rejects.toBeInstanceOf(KnownHostsCorruptError)
    expect(await readFile(file(), 'utf8')).toBe(CORRUPT)
  })

  it('refuses forget() on a corrupt file and leaves the bytes untouched', async () => {
    await writeFile(file(), CORRUPT, 'utf8')
    const kh = new KnownHosts()
    await kh.load()
    expect(kh.status().loadFailed).toBe(true)
    await expect(kh.forget('a.example.com', 22)).rejects.toBeInstanceOf(KnownHostsCorruptError)
    expect(await readFile(file(), 'utf8')).toBe(CORRUPT)
  })

  it('importAll() on a corrupt file does write and clears loadFailed', async () => {
    await writeFile(file(), CORRUPT, 'utf8')
    const kh = new KnownHosts()
    await kh.load()
    expect(kh.status().loadFailed).toBe(true)
    await kh.importAll([{ host: 'c.example.com', port: 22, fingerprint: 'cc' }])
    expect(kh.status().loadFailed).toBe(false)
    // The on-disk record is { fps: string[], firstSeen } — a host can carry
    // several trusted keys.
    const saved = JSON.parse(await readFile(file(), 'utf8')) as Record<string, { fps: string[] }>
    expect(saved['c.example.com:22'].fps).toEqual(['cc'])
  })

  it('a good load lets set() write the fingerprint', async () => {
    const kh = new KnownHosts()
    await kh.load()
    expect(kh.status().loadFailed).toBe(false)
    await kh.set('d.example.com', 2222, 'dd')
    const saved = JSON.parse(await readFile(file(), 'utf8')) as Record<string, { fps: string[] }>
    expect(saved['d.example.com:2222'].fps).toEqual(['dd'])
    expect(kh.get('d.example.com', 2222)).toBe('dd')
  })
})
