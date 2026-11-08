import { describe, expect, it } from 'vitest'
import { parseSshConfig } from './sshConfigParse'

const parse = (text: string): ReturnType<typeof parseSshConfig> =>
  parseSshConfig(text, 'C:\\Users\\Wyatt')

describe('parseSshConfig', () => {
  it('reads a plain block', () => {
    const [h] = parse(
      ['Host db', '  HostName 10.0.0.5', '  User postgres', '  Port 2222', '  IdentityFile ~/.ssh/id_db'].join('\n')
    )
    expect(h).toMatchObject({
      host: 'db',
      hostname: '10.0.0.5',
      user: 'postgres',
      port: 2222,
      identityFile: 'C:\\Users\\Wyatt/.ssh/id_db'
    })
  })

  it('accepts Key=value as well as Key value', () => {
    const [h] = parse(['Host db', 'User=root', 'Port=2200'].join('\n'))
    expect(h.user).toBe('root')
    expect(h.port).toBe(2200)
  })

  it('takes the first value when a keyword repeats', () => {
    // OpenSSH: the first obtained value wins.
    const [h] = parse(['Host db', 'User root', 'User bob'].join('\n'))
    expect(h.user).toBe('root')
  })

  it('uses the first literal name of Host a b c', () => {
    const hosts = parse(['Host a b c', '  HostName 10.0.0.9'].join('\n'))
    expect(hosts.map((h) => h.host)).toEqual(['a'])
  })

  it('does not attach Match directives to the preceding host', () => {
    const hosts = parse(
      ['Host first', '  User alice', 'Match host second', '  User matched', '  Port 2200'].join('\n')
    )
    expect(hosts).toHaveLength(1)
    expect(hosts[0]).toMatchObject({ host: 'first', user: 'alice' })
    expect(hosts[0].port).toBeUndefined()
  })

  it('applies Host * values as defaults without overriding a block', () => {
    const hosts = parse(
      ['Host *', '  User staruser', '  Port 2022', '  IdentityFile ~/.ssh/id_common', '', 'Host db', '  HostName 10.0.0.5', '  User postgres'].join('\n')
    )
    expect(hosts[0]).toMatchObject({ host: 'db', user: 'postgres', port: 2022 })
    expect(hosts[0].identityFile).toBe('C:\\Users\\Wyatt/.ssh/id_common')
  })

  it('does not inherit LocalForward from Host *', () => {
    const hosts = parse(['Host *', '  LocalForward 8080 localhost:80', 'Host db'].join('\n'))
    expect(hosts[0].forwards).toBeUndefined()
  })

  it('treats ProxyJump none as no jump', () => {
    const [h] = parse(['Host db', '  ProxyJump none'].join('\n'))
    expect(h.proxyJump).toBeUndefined()
  })

  it('keeps a # inside a path but drops comment lines', () => {
    const [h] = parse(['# a comment', 'Host db', '  IdentityFile ~/.ssh/key#1'].join('\n'))
    expect(h.host).toBe('db')
    expect(h.identityFile).toBe('C:\\Users\\Wyatt/.ssh/key#1')
  })

  it('ignores glob-only blocks instead of importing them as hosts', () => {
    const hosts = parse(['Host *', '  User root', 'Host *.internal', '  Port 2222'].join('\n'))
    expect(hosts).toEqual([])
  })

  it('keeps multiple LocalForward lines', () => {
    const [h] = parse(
      ['Host db', '  LocalForward 5432 db.local:5432', '  LocalForward 6379 redis.local:6379'].join('\n')
    )
    expect(h.forwards).toHaveLength(2)
    expect(h.forwards?.[0]).toMatchObject({ localPort: 5432, remoteHost: 'db.local', remotePort: 5432 })
  })
})
