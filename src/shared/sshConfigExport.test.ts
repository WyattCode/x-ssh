import { describe, expect, it } from 'vitest'
import { buildSshConfig, quoteConfigValue } from './sshConfigExport'
import type { Host } from './types'

function host(over: Partial<Host>): Host {
  return {
    id: 'h1',
    label: 'web',
    host: '10.0.0.1',
    port: 22,
    username: 'root',
    auth: 'password',
    ...over
  } as Host
}

/** One `Host <alias>` block per host, in order. */
const hostLines = (cfg: string): string[] => cfg.split('\n').filter((l) => l.startsWith('Host '))

describe('buildSshConfig', () => {
  it('gives duplicate labels distinct aliases', () => {
    const cfg = buildSshConfig([
      host({ id: 'a', label: 'web', host: '10.0.0.1' }),
      host({ id: 'b', label: 'web', host: '10.0.0.2' })
    ])
    expect(hostLines(cfg)).toEqual(['Host web', 'Host web-2'])
  })

  it('points ProxyJump at the alias of the right host, not the first duplicate', () => {
    const cfg = buildSshConfig([
      host({ id: 'a', label: 'web', host: '10.0.0.1' }),
      host({ id: 'b', label: 'web', host: '10.0.0.2' }),
      host({ id: 'c', label: 'db', host: '10.0.0.3', jumpHostId: 'b' })
    ])
    // The bug: `ProxyJump web` resolved to 10.0.0.1 in OpenSSH.
    expect(cfg).toContain('ProxyJump web-2')
  })

  it('quotes values that contain spaces', () => {
    const cfg = buildSshConfig([
      host({ username: 'John Smith', keyPath: 'C:\\Users\\John Smith\\.ssh\\id_rsa', auth: 'key' })
    ])
    expect(cfg).toContain('User "John Smith"')
    expect(cfg).toContain('IdentityFile "C:\\Users\\John Smith\\.ssh\\id_rsa"')
  })

  it('omits an empty User instead of emitting a syntax error', () => {
    const cfg = buildSshConfig([host({ username: '' })])
    expect(cfg).not.toContain('User')
    expect(cfg).toContain('HostName 10.0.0.1')
  })

  it('never lets a newline in group start a new directive', () => {
    const cfg = buildSshConfig([host({ group: 'prod\nProxyCommand evil' })])
    // A real directive, not the text inside a comment.
    const live = cfg.split('\n').filter((l) => /^\s*ProxyCommand\b/.test(l))
    expect(live).toEqual([])
    expect(cfg).toContain('# group: prod ProxyCommand evil')
  })

  it('strips glob characters from an alias', () => {
    const cfg = buildSshConfig([host({ label: '*' }), host({ id: 'b', label: '!bad' })])
    const lines = hostLines(cfg)
    expect(lines[0]).not.toContain('*')
    expect(lines[1]).not.toContain('!')
  })

  it('falls back to user@host when the label is empty, and to host when both are', () => {
    expect(buildSshConfig([host({ label: '', username: 'root' })])).toContain('Host root@10.0.0.1')
    expect(buildSshConfig([host({ label: '', username: '' })])).toContain('Host 10.0.0.1')
  })

  it('writes HostName/Port always, and never a stored password', () => {
    const cfg = buildSshConfig([host({ port: 2222 })])
    expect(cfg).toContain('HostName 10.0.0.1')
    expect(cfg).toContain('Port 2222')
    expect(cfg.toLowerCase()).not.toContain('password ')
  })
})

describe('quoteConfigValue', () => {
  it('leaves a plain token alone', () => {
    expect(quoteConfigValue('root')).toBe('root')
  })

  it('quotes spaces and escapes an embedded quote', () => {
    expect(quoteConfigValue('a b')).toBe('"a b"')
    expect(quoteConfigValue('a"b')).toBe('"a\\"b"')
  })

  it('collapses newlines rather than emitting two directives', () => {
    expect(quoteConfigValue('a\nb')).toBe('"a b"')
  })

  it('returns empty for blank input so the caller can skip the line', () => {
    expect(quoteConfigValue('   ')).toBe('')
  })
})
