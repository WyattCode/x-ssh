import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Host } from '../shared/types'

/**
 * The proxy password is a credential like the SSH one: it must live in the
 * encrypted vault, never in hosts.json, and must not be handed back to the
 * renderer. Older builds wrote it in plaintext, so an existing profile has to
 * be migrated rather than silently dropped.
 */
let dir = ''

vi.mock('electron', () => ({
  app: { getPath: () => dir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from('enc:' + s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8').slice(4)
  }
}))

const { HostStore } = await import('./store')

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'xssh-proxy-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const host = (over: Partial<Host> = {}): Host =>
  ({
    id: 'h1',
    label: 'proxy host',
    host: 'example.com',
    port: 22,
    username: 'u',
    auth: 'password',
    proxy: {
      host: '127.0.0.1',
      port: 1080,
      type: 'socks5',
      username: 'pu',
      password: 'proxy-secret'
    },
    ...over
  }) as Host

describe('proxy password storage', () => {
  it('never writes the proxy password to hosts.json', async () => {
    const store = new HostStore()
    await store.save(host(), 'ssh-secret')
    const disk = await readFile(join(dir, 'hosts.json'), 'utf8')
    expect(disk).not.toContain('proxy-secret')
    expect(disk).not.toContain('ssh-secret')
    expect(await store.getProxyPassword('h1')).toBe('proxy-secret')
  })

  it('does not hand the stored proxy password back to the renderer', async () => {
    const store = new HostStore()
    await store.save(host())
    const [h] = await store.list()
    expect(h.proxy?.password).toBeUndefined()
    expect(h.hasSavedProxyPassword).toBe(true)
  })

  it('keeps the saved password when an edit leaves the field blank', async () => {
    const store = new HostStore()
    await store.save(host())
    const [saved] = await store.list()
    await store.save(saved) // the editor sends no password
    expect(await store.getProxyPassword('h1')).toBe('proxy-secret')
  })

  it('removes the password when a save sends an empty one', async () => {
    const store = new HostStore()
    await store.save(host())
    const [saved] = await store.list()
    // The editor's "Clear" action sends '' — not "absent" — to mean delete.
    await store.save({ ...saved, proxy: { ...saved.proxy!, password: '' } })
    expect(await store.getProxyPassword('h1')).toBeUndefined()
    const [after] = await store.list()
    expect(after.hasSavedProxyPassword).toBe(false)
  })

  it('drops the password when the host stops using a proxy', async () => {
    const store = new HostStore()
    await store.save(host())
    const [saved] = await store.list()
    await store.save({ ...saved, proxy: undefined })
    expect(await store.getProxyPassword('h1')).toBeUndefined()
  })

  it('moves a plaintext password from an older hosts.json into the vault', async () => {
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'hosts.json'), JSON.stringify([host()], null, 2))
    const store = new HostStore()
    await store.list()
    expect(await store.getProxyPassword('h1')).toBe('proxy-secret')
    const disk = await readFile(join(dir, 'hosts.json'), 'utf8')
    expect(disk).not.toContain('proxy-secret')
  })
})
