import { describe, expect, it } from 'vitest'
import { hostMatches } from './hostMatch'
import type { Host } from '../../../shared/types'

const h = (extra: Partial<Host>): Host =>
  ({ id: 'x', label: 'edge-prod-01', host: '192.0.2.24', port: 2222, username: 'ops', auth: 'key', ...extra }) as Host

describe('hostMatches', () => {
  it('finds a host by name or by any form of its address', () => {
    const host = h({})
    for (const q of ['edge', 'prod-01', '192.0.2', '192.0.2.24:2222', 'ops@192.0.2.24', 'ops@192.0.2.24:2222', ':2222']) {
      expect(hostMatches(host, q)).toBe(true)
    }
  })
  it('treats the default port as :22', () => {
    expect(hostMatches(h({ port: 22 }), '192.0.2.24:22')).toBe(true)
    expect(hostMatches(h({ port: 0 }), '192.0.2.24:22')).toBe(true)
  })
  it('requires every word, and misses what is not there', () => {
    expect(hostMatches(h({}), 'edge 192.0.2')).toBe(true)
    expect(hostMatches(h({}), 'edge 10.0.0')).toBe(false)
    expect(hostMatches(h({}), '2223')).toBe(false)
    expect(hostMatches(h({}), '')).toBe(true)
  })
  it('also looks at group, tags and OS', () => {
    const host = h({ group: '生产', tags: ['gpu'], os: { pretty: 'Ubuntu 24.04 LTS' } as never })
    expect(hostMatches(host, '生产')).toBe(true)
    expect(hostMatches(host, 'gpu')).toBe(true)
    expect(hostMatches(host, 'ubuntu')).toBe(true)
  })
})
