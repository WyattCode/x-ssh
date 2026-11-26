import { describe, it, expect } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ssh2 from 'ssh2'
import {
  KeyManager,
  MAX_KEYGEN_VERIFY_ATTEMPTS,
  keyPairRoundTrips,
  type Ssh2Keygen
} from './keyManager'

// Preventive hardening for the ssh2@1.17.0 keygen bug (see keyPairRoundTrips):
// ~1/256 of generated ed25519 keys serialize with a truncated public blob that
// ssh2's own parseKey rejects. generate() must regenerate such candidates and
// must NEVER write one out. The real bug is too rare for a unit test to wait
// for, so these tests inject a fake keygen that fails parseKey a fixed number
// of times. testHostKey.ts:genTestHostKey() works around the same bug on the
// test side; this file covers the production-side guard.

/** A synthetic "wire blob" the fake pair and its fake parsed key share. */
const FAKE_WIRE = Buffer.from([0x00, 0x00, 0x33, 0x00, 0x0a, 0x73, 0x73, 0x68]) // leading 0x00s on purpose

function fakeKeygen(parseFailures: number): {
  keygen: Ssh2Keygen
  calls: { generate: number; parse: number; passphrases: Array<string | undefined> }
} {
  const calls = { generate: 0, parse: 0, passphrases: [] as Array<string | undefined> }
  let seq = 0
  return {
    calls,
    keygen: {
      generateKeyPair: async (_type, options) => {
        calls.generate++
        seq++
        return {
          private: `FAKE-PRIVATE-${seq}`,
          public: `ssh-ed25519 ${FAKE_WIRE.toString('base64')} ${options.comment}`
        }
      },
      parseKey: (_key, passphrase) => {
        calls.parse++
        calls.passphrases.push(passphrase)
        if (calls.parse <= parseFailures) return new Error('Malformed OpenSSH private key')
        return { getPublicSSH: () => FAKE_WIRE }
      }
    }
  }
}

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'xssh-keymgr-'))
}

describe('KeyManager.generate — parseKey round-trip retry (ssh2@1.17 keygen bug)', () => {
  it('first parseKey attempts fail → regenerates and returns a usable key', async () => {
    const dir = await tempDir()
    try {
      const fake = fakeKeygen(3)
      const mgr = new KeyManager(dir, fake.keygen)
      const key = await mgr.generate({ name: 'retry-key' })
      // 3 rejected candidates + 1 accepted: each rejected one triggered a fresh generate.
      expect(fake.calls.parse).toBe(4)
      expect(fake.calls.generate).toBe(4)
      // The written key is the 4th (surviving) candidate, not a rejected one.
      const priv = join(dir, 'keys', key.id)
      expect(await readFile(priv, 'utf8')).toBe('FAKE-PRIVATE-4')
      expect(await readFile(`${priv}.pub`, 'utf8')).toContain(FAKE_WIRE.toString('base64'))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('public blob mismatch (parseKey OK but getPublicSSH differs) also retries', async () => {
    const dir = await tempDir()
    try {
      let seq = 0
      const calls = { generate: 0, parse: 0 }
      const keygen: Ssh2Keygen = {
        generateKeyPair: async (_t, o) => {
          calls.generate++
          seq++
          return {
            private: `FAKE-PRIVATE-${seq}`,
            public: `ssh-ed25519 ${FAKE_WIRE.toString('base64')} ${o.comment}`
          }
        },
        parseKey: () => {
          calls.parse++
          // Candidate 1: parses fine but its wire blob differs from the .pub line.
          if (calls.parse === 1) return { getPublicSSH: () => Buffer.from([1, 2, 3]) }
          return { getPublicSSH: () => FAKE_WIRE }
        }
      }
      const key = await new KeyManager(dir, keygen).generate({ name: 'mismatch' })
      expect(calls.parse).toBe(2)
      expect(calls.generate).toBe(2)
      const priv = join(dir, 'keys', key.id)
      expect(await readFile(priv, 'utf8')).toBe('FAKE-PRIVATE-2')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('every attempt fails → throws keygen-failed with context, writes nothing, caps at the bound', async () => {
    const dir = await tempDir()
    try {
      const fake = fakeKeygen(MAX_KEYGEN_VERIFY_ATTEMPTS + 10)
      const mgr = new KeyManager(dir, fake.keygen)
      const err = await mgr.generate({ name: 'never' }).then(
        () => null,
        (e: unknown) => e as Error & { cause?: Error }
      )
      expect(err).not.toBeNull()
      // Stable UI marker is exactly 'keygen-failed' (renderer maps it to a
      // localized message); the retry context rides along in cause.
      expect(err!.message).toBe('keygen-failed')
      expect(String(err!.cause?.message)).toContain(String(MAX_KEYGEN_VERIFY_ATTEMPTS))
      expect(String(err!.cause?.message)).toMatch(/round-trip/i)
      expect(String(err!.cause?.message)).toMatch(/attempt 64: .*Malformed OpenSSH private key/)
      // Hard cap: exactly the bound, no infinite loop, one parse per candidate.
      expect(fake.calls.generate).toBe(MAX_KEYGEN_VERIFY_ATTEMPTS)
      expect(fake.calls.parse).toBe(MAX_KEYGEN_VERIFY_ATTEMPTS)
      // Nothing was written — no silently-degraded key in the library.
      expect(await readdir(join(dir, 'keys'))).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('passphrase is forwarded to parseKey for the round-trip check', async () => {
    const dir = await tempDir()
    try {
      const fake = fakeKeygen(0)
      await new KeyManager(dir, fake.keygen).generate({ name: 'enc', passphrase: 'pw123' })
      expect(fake.calls.passphrases).toEqual(['pw123'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('keyPairRoundTrips — direct checks against real ssh2', () => {
  it('accepts a freshly generated real key pair (ed25519)', () => {
    const kp = ssh2.utils.generateKeyPairSync('ed25519', { comment: 'x-ssh-test' })
    // Wire the check to the real ssh2 utils.
    const real: Ssh2Keygen = {
      generateKeyPair: async () => kp,
      parseKey: (key, passphrase) => ssh2.utils.parseKey(key, passphrase)
    }
    expect(keyPairRoundTrips(real, kp)).toEqual({ ok: true })
  })

  it('rejects a pair whose private key is unparseable / blob-mismatched', () => {
    const real: Ssh2Keygen = {
      generateKeyPair: async () => ({ private: '', public: '' }),
      parseKey: () => new Error('Malformed OpenSSH private key')
    }
    const bad = keyPairRoundTrips(real, {
      private: 'x',
      public: `ssh-ed25519 ${FAKE_WIRE.toString('base64')} c`
    })
    expect(bad.ok).toBe(false)
    expect((bad as { ok: false; why: string }).why).toMatch(/Malformed/)
  })
})

describe('KeyManager.generate — real ssh2 end to end', () => {
  it('default seam (no injection) produces a key that survives parseKey and matches its .pub blob', async () => {
    const dir = await tempDir()
    try {
      const key = await new KeyManager(dir).generate({ name: 'real' })
      const priv = join(dir, 'keys', key.id)
      const privText = await readFile(priv, 'utf8')
      const parsed = ssh2.utils.parseKey(privText)
      expect(parsed instanceof Error).toBe(false)
      const pubText = await readFile(`${priv}.pub`, 'utf8')
      const blob = Buffer.from(pubText.trim().split(/\s+/)[1], 'base64')
      expect((parsed as { getPublicSSH(): Buffer }).getPublicSSH().equals(blob)).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
