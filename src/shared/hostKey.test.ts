import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { formatFingerprint, isFingerprintHex } from './hostKey'

describe('formatFingerprint', () => {
  it('shows the stored sha256 hex the way ssh-keygen -lf prints it', () => {
    const blob = Buffer.from('any public key blob')
    const hex = createHash('sha256').update(blob).digest('hex')
    const keygen = 'SHA256:' + createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')
    expect(formatFingerprint(hex)).toBe(keygen)
    expect(formatFingerprint(hex.toUpperCase())).toBe(keygen)
  })
  it('leaves anything else alone', () => {
    expect(formatFingerprint('')).toBe('')
    expect(formatFingerprint(undefined)).toBe('')
    expect(formatFingerprint('SHA256:abc')).toBe('SHA256:abc')
  })
  it('recognizes only 64 hex digits', () => {
    expect(isFingerprintHex('a'.repeat(64))).toBe(true)
    expect(isFingerprintHex('a'.repeat(63))).toBe(false)
    expect(isFingerprintHex('g'.repeat(64))).toBe(false)
    expect(isFingerprintHex(42)).toBe(false)
  })
})
