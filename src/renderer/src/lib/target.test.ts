import { describe, it, expect } from 'vitest'
import { parseTarget } from './target'

describe('parseTarget', () => {
  it('parses user@host', () => {
    expect(parseTarget('alice@example.com')).toEqual({ username: 'alice', host: 'example.com', port: 22 })
  })

  it('parses host with port', () => {
    expect(parseTarget('example.com:2222')).toEqual({ host: 'example.com', port: 2222 })
  })

  it('parses user@host:port', () => {
    expect(parseTarget('alice@example.com:2200')).toEqual({
      username: 'alice',
      host: 'example.com',
      port: 2200
    })
  })

  it('parses bare hostnames and IPs', () => {
    expect(parseTarget('192.168.1.10')).toEqual({ host: '192.168.1.10', port: 22 })
    expect(parseTarget('example.com')).toEqual({ host: 'example.com', port: 22 })
  })

  it('rejects a bare single word with no user/port (likely a search term)', () => {
    expect(parseTarget('dev-host')).toBeNull()
    expect(parseTarget('mydb')).toBeNull()
  })

  it('allows a bare word when a username or port is present', () => {
    expect(parseTarget('root@server')).toEqual({ username: 'root', host: 'server', port: 22 })
    expect(parseTarget('server:2200')).toEqual({ host: 'server', port: 2200 })
  })

  it('rejects whitespace and empty input', () => {
    expect(parseTarget('')).toBeNull()
    expect(parseTarget('   ')).toBeNull()
    expect(parseTarget('alice@example.com bad')).toBeNull()
  })

  it('rejects out-of-range or non-integer ports', () => {
    expect(parseTarget('h:0')).toBeNull()
    expect(parseTarget('h:70000')).toBeNull()
    expect(parseTarget('h:abc')).toBeNull()
    expect(parseTarget('h:-1')).toBeNull()
  })

  it('rejects hosts containing illegal characters', () => {
    expect(parseTarget('exa mple.com')).toBeNull()
    expect(parseTarget('exa$mple.com')).toBeNull()
  })
})
