import { describe, it, expect } from 'vitest'
import {
  readLaunchTarget,
  targetFromUrl,
  compareVersions
} from './launchTarget'

describe('targetFromUrl', () => {
  it('parses a host-only protocol URL', () => {
    expect(targetFromUrl('x-ssh://example.com')).toBe('example.com')
  })
  it('parses user + host + port', () => {
    expect(targetFromUrl('x-ssh://root@example.com:2222')).toBe('root@example.com:2222')
  })
  it('rejects non-x-ssh schemes', () => {
    expect(targetFromUrl('https://example.com')).toBeNull()
  })
  it('rejects a malformed URL', () => {
    expect(targetFromUrl('not a url')).toBeNull()
  })
})

describe('readLaunchTarget', () => {
  it('finds an x-ssh:// URL in the args', () => {
    expect(readLaunchTarget(['x-ssh://user@host:22'])).toBe('user@host:22')
  })
  it('finds a -c switch value', () => {
    expect(readLaunchTarget(['-c', 'root@h', '--verbose'])).toBe('root@h')
  })
  it('finds a --connect=value form', () => {
    expect(readLaunchTarget(['--connect=me@thing:2022'])).toBe('me@thing:2022')
  })
  it('returns null when no target is present', () => {
    expect(readLaunchTarget(['--verbose'])).toBeNull()
  })
})

describe('compareVersions', () => {
  it('orders same-length versions', () => {
    expect(compareVersions('0.2.0', '0.2.0')).toBe(0)
    expect(compareVersions('0.3.0', '0.2.0')).toBeGreaterThan(0)
    expect(compareVersions('0.2.0', '0.2.1')).toBeLessThan(0)
  })
  it('handles differing segment counts', () => {
    expect(compareVersions('0.2', '0.2.0')).toBe(0)
    expect(compareVersions('1.0', '0.9.9')).toBeGreaterThan(0)
  })
})
