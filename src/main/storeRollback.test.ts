import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Host } from '../shared/types'

/**
 * Every mutation of the host list / vault must be atomic with the disk write.
 * `delete()` already rolls back; the other mutators did not. A failed write
 * left memory holding the edit while the file on disk still had the old data,
 * so the *next* unrelated save silently applied an edit the user was told had
 * failed — or, worse, cleared a load-failure guard and overwrote an unreadable
 * file with an empty list.
 */
let dir = ''
let encryptAvailable = true
let decryptFails = false
let hostsWriteFails = false
let vaultWriteFails = false

vi.mock('electron', () => ({
  app: { getPath: () => dir },
  safeStorage: {
    isEncryptionAvailable: () => encryptAvailable,
    encryptString: (s: string) => Buffer.from('enc:' + s, 'utf8'),
    decryptString: (b: Buffer) => {
      if (decryptFails) throw new Error('cannot decrypt on this machine')
      const t = b.toString('utf8')
      if (!t.startsWith('enc:')) throw new Error('not our format')
      return t.slice(4)
    }
  }
}))

vi.mock('./durableFile', async (orig) => {
  const actual = await orig<typeof import('./durableFile')>()
  return {
    ...actual,
    writeDurable: async (path: string, data: string | Buffer, mode?: number) => {
      if (hostsWriteFails && path.endsWith('hosts.json')) {
        throw Object.assign(new Error('ENOSPC: simulated full disk'), { code: 'ENOSPC' })
      }
      if (vaultWriteFails && path.endsWith('secrets.bin')) {
        throw Object.assign(new Error('EPERM: simulated vault failure'), { code: 'EPERM' })
      }
      return actual.writeDurable(path, data, mode)
    }
  }
})

const { HostStore } = await import('./store')

const host = (id: string, name: string): Host =>
  ({ id, name, label: name, host: `${name}.lan`, port: 22, username: 'u', auth: 'password' }) as unknown as Host
const hostsFile = (): string => join(dir, 'hosts.json')
const vaultFile = (): string => join(dir, 'secrets.bin')

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'xssh-rollback-'))
  encryptAvailable = true
  decryptFails = false
  hostsWriteFails = false
  vaultWriteFails = false
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('HostStore: failed writes must roll back in-memory state', () => {
  it('save(): a refused host edit is not applied by a later successful save', async () => {
    const store = new HostStore()
    await store.save(host('a', 'alpha'))

    hostsWriteFails = true
    await expect(store.save(host('b', 'beta'))).rejects.toThrow(/ENOSPC/)
    hostsWriteFails = false

    // The edit was reported as failed; memory must agree with hosts.json.
    expect((await store.list()).map((h) => h.id)).toEqual(['a'])
    await store.save(host('c', 'gamma'))
    const onDisk = JSON.parse(await readFile(hostsFile(), 'utf8')) as Host[]
    expect(onDisk.map((h) => h.id)).toEqual(['a', 'c'])
    expect(onDisk.map((h) => h.id)).not.toContain('b')
  })

  it('importJson(): a failed import keeps the old hosts and the vault intact', async () => {
    const store = new HostStore()
    await store.save(host('a', 'alpha'), 'old-secret')

    const backup = JSON.stringify({
      app: 'x-ssh',
      version: 1,
      hosts: [{ ...host('z', 'zeta'), password: 'new-secret' }]
    })
    hostsWriteFails = true
    await expect(store.importJson(backup)).rejects.toThrow(/ENOSPC/)
    hostsWriteFails = false

    expect((await store.list()).map((h) => h.id)).toEqual(['a'])
    expect(await store.getPassword('a')).toBe('old-secret')
    expect(await store.getPassword('z')).toBeUndefined()
  })

  it('importJson(): a failed import must not clear the "vault unreadable" guard', async () => {
    // First write a real vault with a saved password.
    const seed = new HostStore()
    await seed.save(host('a', 'alpha'), 'keep-me')
    const originalVault = await readFile(vaultFile())

    // Simulate a machine that can no longer decrypt that vault.
    decryptFails = true
    const store = new HostStore()
    expect(await store.secretsStatus()).toBe('bad')
    // A failed import clears secretsLoadFailed in the unfixed implementation;
    // that lets the NEXT save overwrite the unreadable vault with an empty one.
    decryptFails = false
    hostsWriteFails = true
    await expect(
      store.importJson(JSON.stringify({ app: 'x-ssh', version: 1, hosts: [host('z', 'zeta')] }))
    ).rejects.toThrow(/ENOSPC/)
    hostsWriteFails = false
    decryptFails = true

    await expect(store.save(host('c', 'gamma'), 'pw')).rejects.toThrow(/secrets-unreadable/)
    expect((await readFile(vaultFile())).equals(originalVault)).toBe(true)
  })

  it('resetHosts(): a failed reset keeps the unreadable list protected', async () => {
    const broken = '[{"id": "a", "na'
    await writeFile(hostsFile(), broken, 'utf8')
    const store = new HostStore()
    hostsWriteFails = true
    await expect(store.resetHosts()).rejects.toThrow(/ENOSPC/)
    hostsWriteFails = false

    // The guard must still be up: saving any host is refused rather than
    // replacing the unreadable file with a one-host list.
    await expect(store.save(host('c', 'gamma'))).rejects.toThrow(/hosts-unreadable/)
    expect(await readFile(hostsFile(), 'utf8')).toBe(broken)
  })

  it('resetSecrets(): a failed reset keeps the unreadable vault protected', async () => {
    const seed = new HostStore()
    await seed.save(host('a', 'alpha'), 'keep-me')
    const originalVault = await readFile(vaultFile())

    decryptFails = true
    const store = new HostStore()
    vaultWriteFails = true
    await expect(store.resetSecrets()).rejects.toThrow(/EPERM/)
    vaultWriteFails = false

    await expect(store.save(host('c', 'gamma'), 'pw')).rejects.toThrow(/secrets-unreadable/)
    expect((await readFile(vaultFile())).equals(originalVault)).toBe(true)
  })

  it('setOs(): a failed write does not leave a phantom OS badge in memory', async () => {
    const store = new HostStore()
    await store.save(host('a', 'alpha'))
    hostsWriteFails = true
    await expect(store.setOs('a', { id: 'ubuntu', pretty: 'Ubuntu' } as never)).rejects.toThrow(/ENOSPC/)
    hostsWriteFails = false
    expect((await store.list())[0].os).toBeUndefined()
  })
})
