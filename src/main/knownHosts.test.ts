import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// KnownHosts takes its folder from app.getPath at construction; point it at a
// fresh temp dir per test. The mock must be registered before the dynamic
// import below, so the module sees it.
let dir = ''
vi.mock('electron', () => ({
  app: { getPath: () => dir }
}))

const { KnownHosts, KnownHostsCorruptError } = await import('./knownHosts')

const file = (): string => join(dir, 'known_hosts.json')
/** A truncated JSON document: parses as neither the main file nor a backup. */
const CORRUPT = '{"a.example.com:22": {"fp": "aa'

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'xssh-known-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('KnownHosts corrupt fail-closed', () => {
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
    const saved = JSON.parse(await readFile(file(), 'utf8')) as Record<string, { fp: string }>
    expect(saved['c.example.com:22'].fp).toBe('cc')
  })

  it('a good load lets set() write the fingerprint', async () => {
    const kh = new KnownHosts()
    await kh.load()
    expect(kh.status().loadFailed).toBe(false)
    await kh.set('d.example.com', 2222, 'dd')
    const saved = JSON.parse(await readFile(file(), 'utf8')) as Record<string, { fp: string }>
    expect(saved['d.example.com:2222'].fp).toBe('dd')
    expect(kh.get('d.example.com', 2222)).toBe('dd')
  })
})
