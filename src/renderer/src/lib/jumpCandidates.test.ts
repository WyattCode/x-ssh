import { describe, expect, it } from 'vitest'
import type { Host } from '../../../shared/types'
import {
  jumpCandidates,
  jumpSelectBlocked,
  jumpSelectOptions,
  jumpUsedBy
} from './jumpCandidates'

function mk(id: string, extra: Partial<Host> = {}): Host {
  return {
    id,
    label: id,
    host: `${id}.example.com`,
    port: 22,
    username: 'root',
    auth: 'password',
    ...extra
  }
}

// bastion: no jump of its own (a legal one-hop jump host).
// web / db: already tunnel through bastion, so they may not be picked as a jump.
const bastion = mk('bastion')
const web = mk('web', { jumpHostId: 'bastion' })
const db = mk('db', { jumpHostId: 'bastion' })
const solo = mk('solo')

describe('jumpCandidates', () => {
  it('excludes the host itself', () => {
    const ids = jumpCandidates([bastion, web, db, solo], 'solo').map((h) => h.id)
    expect(ids).not.toContain('solo')
  })

  it('excludes hosts that already jump through another host', () => {
    const ids = jumpCandidates([bastion, web, db, solo], 'solo').map((h) => h.id)
    expect(ids).toEqual(['bastion'])
  })

  it('offers every jump-free host when creating a new host', () => {
    const ids = jumpCandidates([bastion, web, db, solo], undefined).map((h) => h.id)
    expect(ids).toEqual(['bastion', 'solo'])
  })
})

describe('jumpUsedBy', () => {
  it('lists the hosts tunnelling through the given host', () => {
    expect(jumpUsedBy([bastion, web, db, solo], 'bastion').map((h) => h.id)).toEqual(['web', 'db'])
  })

  it('is empty for a new host', () => {
    expect(jumpUsedBy([bastion, web], undefined)).toEqual([])
  })

  it('is empty for a host nobody jumps through', () => {
    expect(jumpUsedBy([bastion, web], 'solo')).toEqual([])
  })
})

describe('jumpSelectBlocked', () => {
  it('blocks starting a new nest on a host others already jump through', () => {
    expect(jumpSelectBlocked([bastion, web], 'bastion', '')).toBe(true)
  })

  it('allows clearing an existing jump on such a host', () => {
    expect(jumpSelectBlocked([bastion, web], 'bastion', 'solo')).toBe(false)
  })

  it('does not block a host nobody jumps through', () => {
    expect(jumpSelectBlocked([bastion, web], 'solo', '')).toBe(false)
  })

  it('does not block a new (unsaved) host', () => {
    expect(jumpSelectBlocked([bastion, web], undefined, '')).toBe(false)
  })
})

describe('jumpSelectOptions', () => {
  it('returns the plain candidates when nothing is chosen', () => {
    const ids = jumpSelectOptions([bastion, web, solo], 'solo', '').map((h) => h.id)
    expect(ids).toEqual(['bastion'])
  })

  it('keeps the chosen jump when it is already a candidate', () => {
    const ids = jumpSelectOptions([bastion, web, solo], 'solo', 'bastion').map((h) => h.id)
    expect(ids).toEqual(['bastion'])
  })

  it('prepends a legacy nested jump so the select still has a label', () => {
    // `web` jumps through `bastion`, so it is not a candidate for `db` — but
    // legacy data may already point there and must stay visible.
    const opts = jumpSelectOptions([bastion, web, db], 'db', 'web')
    expect(opts.map((h) => h.id)).toEqual(['web', 'bastion'])
  })

  it('ignores a chosen id that no longer exists', () => {
    const ids = jumpSelectOptions([bastion, solo], 'solo', 'gone').map((h) => h.id)
    expect(ids).toEqual(['bastion'])
  })
})
