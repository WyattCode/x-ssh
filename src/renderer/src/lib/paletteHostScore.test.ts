import { describe, expect, it } from 'vitest'
import { paletteHostScore } from './paletteHostScore'
import type { Host } from '../../../shared/types'

function host(over: Partial<Host> = {}): Host {
  return {
    id: 'h1',
    label: 'web-01',
    host: '10.0.0.1',
    port: 22,
    username: 'root',
    auth: 'password',
    ...over
  }
}

describe('paletteHostScore', () => {
  it('returns 0 for an empty query', () => {
    expect(paletteHostScore('', host())).toBe(0)
  })

  it('matches a tag', () => {
    expect(paletteHostScore('prod', host({ tags: ['production'] }))).toBeGreaterThan(-1)
  })

  it('matches a group', () => {
    expect(paletteHostScore('db', host({ group: 'db-servers' }))).toBeGreaterThan(-1)
  })

  it('matches the bare host', () => {
    expect(paletteHostScore('10.0', host())).toBeGreaterThan(-1)
  })

  it('returns -1 when nothing matches', () => {
    expect(paletteHostScore('zzz', host())).toBe(-1)
  })
})
