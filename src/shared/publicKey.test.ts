import { it, expect } from 'vitest'
import { validatePublicKey, publishKeyCommand } from './publicKey'
it('B22 rejects multiline public keys and quotes shell metacharacters as data', () => {
  expect(() => validatePublicKey('ssh-ed25519 AAAA\nXSSH\ntouch /tmp/pwn')).toThrow('invalid-key')
  expect(() => validatePublicKey('ssh-ed25519 !bad')).toThrow('invalid-key')
  const key = 'ssh-ed25519 AAAA comment\u0027;touch /tmp/pwn'
  expect(publishKeyCommand(key)).not.toContain('<<')
  expect(publishKeyCommand(key)).toContain("printf '%s\\n'")
})
