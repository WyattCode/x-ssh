import { utils } from 'ssh2'

/**
 * Workaround for an ssh2@1.17 keygen bug (lib/keygen.js, parseDERs('ed25519')):
 * converting Node's DER output strips *all* leading 0x00 bytes from the public
 * key (it only wants to drop the DER BIT STRING unused-bits byte), so a random
 * ed25519 key whose public part starts with 0x00 (~1/256 of all keys) is
 * serialized into an OpenSSH private key with a truncated 31-byte public blob,
 * which ssh2's own parseKey then rejects: 'Malformed OpenSSH private key'.
 * Tests that feed the generated key straight to parseKey() or
 * Server({ hostKeys }) die at module import with
 * "utils.parseKey(...).getPublicSSH is not a function" (CI run 45609360612).
 * Regenerate until the key survives a parseKey round-trip.
 */
export function genTestHostKey(): { private: string; public: string } {
  for (let attempt = 0; attempt < 64; attempt++) {
    const kp = utils.generateKeyPairSync('ed25519')
    const parsed = utils.parseKey(kp.private)
    if (!(parsed instanceof Error)) return kp
  }
  throw new Error('ssh2 produced 64 unparseable ed25519 keys in a row')
}
