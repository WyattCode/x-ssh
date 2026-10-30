import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
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
