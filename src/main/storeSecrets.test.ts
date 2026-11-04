import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Host } from '../shared/types'

/**
 * Saving a password must either work or say it did not.
 *
 * The reported bug: editing a host's password showed "保存失败" while the
 * password had in fact been written, and afterwards most hosts had no password
 * left. Two separate faults in `persist()` / `save()`:
 *
 *  1. `persist()` returned silently when the OS could not encrypt, so `save()`
 *     resolved successfully with the password dropped.
 *  2. When a previously written vault could not be decrypted, the guard against
 *     overwriting it was `secrets.length === 0` — so typing ONE password made
 *     the in-memory vault non-empty and the next write replaced the unreadable
 *     file with a single entry, discarding every other stored password.
 *
 * fs is mocked at module scope so each test decides whether the vault write
 * succeeds, without needing real DPAPI.
 */
let dir = ''
let encryptAvailable = true
let decryptFails = false
let vaultWriteFails = false

vi.mock('electron', () => ({
  app: { getPath: () => dir },
  safeStorage: {
    isEncryptionAvailable: () => encryptAvailable,
    // Reversible stand-in for DPAPI: the tests only care whether the call
    // works and whether the plaintext survives the round trip.
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
      // Only the vault is made to fail; hosts.json keeps working so the test
      // can tell "host saved, secret did not" apart from "nothing saved".
      if (vaultWriteFails && path.endsWith('secrets.bin')) {
        throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' })
      }
      return actual.writeDurable(path, data, mode)
    }
  }
})

const { HostStore } = await import('./store')

const host = (id: string, name: string): Host =>
  ({ id, name, label: name, host: `${name}.lan`, port: 22, username: 'u', auth: 'password' }) as unknown as Host

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'xssh-secrets-'))
  encryptAvailable = true
  decryptFails = false
  vaultWriteFails = false
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('saving passwords', () => {
  it('round-trips a password through the vault', async () => {
    const s = new HostStore()
    await s.save(host('a', 'alpha'), 'pw-a')
    expect(await s.getPassword('a')).toBe('pw-a')

    // A fresh store must read it back, i.e. it really reached the disk.
    const next = new HostStore()
    expect(await next.getPassword('a')).toBe('pw-a')
  })

  it('keeps other hosts passworded when one is edited', async () => {
    const s = new HostStore()
    await s.save(host('a', 'alpha'), 'pw-a')
    await s.save(host('b', 'beta'), 'pw-b')

    // The reported case: change B's password. A must be untouched.
    await s.save(host('b', 'beta'), 'pw-b2')
    const next = new HostStore()
    expect(await next.getPassword('a')).toBe('pw-a')
    expect(await next.getPassword('b')).toBe('pw-b2')
  })

  it('does not drop the saved password when the field is left blank', async () => {
    const s = new HostStore()
    await s.save(host('a', 'alpha'), 'pw-a')
    // undefined = "I did not touch this field"; an empty string would mean
    // "clear it". The editor passes undefined for a blank input.
    await s.save(host('a', 'alpha'), undefined)
    expect(await new HostStore().getPassword('a')).toBe('pw-a')
  })

  it('reports failure when the OS cannot encrypt, instead of pretending', async () => {
    encryptAvailable = false
    const s = new HostStore()
    // The password cannot be stored at all — saying "saved" is the bug.
    await expect(s.save(host('a', 'alpha'), 'pw-a')).rejects.toThrow(/secrets-/)
  })

  it('still saves the host itself when only the password failed', async () => {
    encryptAvailable = false
    const s = new HostStore()
    await expect(s.save(host('a', 'alpha'), 'pw-a')).rejects.toThrow()
    // The host must not be lost because its password could not be stored.
    const next = new HostStore()
    expect((await next.list()).map((h) => h.id)).toContain('a')
    expect(await next.getPassword('a')).toBeUndefined()
  })

  it('surfaces a vault write failure rather than reporting success', async () => {
    vaultWriteFails = true
    const s = new HostStore()
    await expect(s.save(host('a', 'alpha'), 'pw-a')).rejects.toThrow()
  })

  it('rolls the in-memory vault back when the write fails', async () => {
    const s = new HostStore()
    await s.save(host('a', 'alpha'), 'pw-a')

    vaultWriteFails = true
    await expect(s.save(host('b', 'beta'), 'pw-b')).rejects.toThrow()

    // The failed edit must not leave b's password sitting in memory where the
    // next successful save would persist a vault that silently gained an entry
    // the disk never accepted.
    vaultWriteFails = false
    expect(await s.getPassword('b')).toBeUndefined()
    expect(await s.getPassword('a')).toBe('pw-a')
  })

  it('refuses to overwrite an unreadable vault with a single new password', async () => {
    // First run writes a real vault.
    const first = new HostStore()
    await first.save(host('a', 'alpha'), 'pw-a')
    await first.save(host('b', 'beta'), 'pw-b')

    // Next launch cannot decrypt it (copied from another machine).
    decryptFails = true
    const blind = new HostStore()
    expect(await blind.getPassword('a')).toBeUndefined()
    expect(blind.secretsUnreadable).toBe(true)

    // Typing one password used to make the vault "non-empty", defeat the guard,
    // and rewrite the file with just this one entry — losing a and b forever.
    await blind.save(host('c', 'gamma'), 'pw-c').catch(() => undefined)

    decryptFails = false
    const recovered = new HostStore()
    expect(await recovered.getPassword('a'), 'a must survive').toBe('pw-a')
    expect(await recovered.getPassword('b'), 'b must survive').toBe('pw-b')
  })
})