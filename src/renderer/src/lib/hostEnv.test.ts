import { describe, expect, it } from 'vitest'
import { hostEnv } from './hostEnv'
import { routeOf, routeText } from './route'

describe('hostEnv', () => {
  it('uses the group, and marks production-like names', () => {
    expect(hostEnv({ group: '生产' })).toEqual({ label: '生产', prod: true })
    expect(hostEnv({ group: 'Production' })).toEqual({ label: 'Production', prod: true })
    expect(hostEnv({ group: '测试' })).toEqual({ label: '测试', prod: false })
    expect(hostEnv({ group: 'Home lab' })).toEqual({ label: 'Home lab', prod: false })
  })
  it('falls back to an environment-looking tag, and to nothing', () => {
    expect(hostEnv({ tags: ['gpu', 'prod'] })).toEqual({ label: 'prod', prod: true })
    expect(hostEnv({ tags: ['gpu'] })).toBeNull()
    expect(hostEnv({})).toBeNull()
    expect(hostEnv(undefined)).toBeNull()
    expect(hostEnv({ group: '  ' })).toBeNull()
  })
})

describe('routeOf', () => {
  const hosts = [
    { id: 'j', label: 'bastion-sg', host: '10.0.0.1', jumpHostId: undefined },
    { id: 't', label: 'edge', host: '10.0.0.9', jumpHostId: 'j' }
  ]
  it('direct when there is no jump', () => {
    expect(routeOf({ host: 'x' }, hosts)).toEqual({ hops: [], direct: true })
  })
  it('names the saved jump host, else the resolved address', () => {
    expect(routeOf({ host: 'x', jumpHostId: 'j' }, hosts)).toEqual({ hops: ['bastion-sg'], direct: false })
    const jump = { host: '1.2.3.4', port: 22, username: 'u', auth: 'agent' } as never
    expect(routeOf({ host: 'x', jump }, [])).toEqual({ hops: ['1.2.3.4'], direct: false })
  })
  it('survives a jump loop and a deleted jump host', () => {
    const loop = [
      { id: 'a', label: 'A', host: 'a', jumpHostId: 'b' },
      { id: 'b', label: 'B', host: 'b', jumpHostId: 'a' }
    ]
    expect(routeOf({ host: 'x', jumpHostId: 'a' }, loop).hops).toEqual(['B', 'A'])
    expect(routeOf({ host: 'x', jumpHostId: 'gone' }, hosts)).toEqual({ hops: [], direct: true })
  })
  it('renders the text', () => {
    expect(routeText(['bastion'], 'edge', '本机')).toBe('本机 › bastion › edge')
    expect(routeText([], 'edge', '本机')).toBe('本机 › edge')
  })
})
