import { describe, expect, it } from 'vitest'
import type { Host } from './types'
import {
  applyHostPatches,
  autoGroupNames,
  buildGroups,
  compareHosts,
  effectiveGroups,
  insertBefore,
  patchesForOrder,
  reorderGroupNames,
  splitSeries
} from './hostGroups'

let n = 0
const h = (label: string, extra: Partial<Host> = {}): Host => ({
  id: `h${++n}`, label, host: `10.0.0.${n}`, port: 22, username: 'u', auth: 'password', ...extra
})

describe('splitSeries', () => {
  it('reads "name + standalone number"', () => {
    expect(splitSeries('AI TOP ATOM 3')).toEqual({ prefix: 'AI TOP ATOM', n: 3 })
    expect(splitSeries('DGX Spark 12')).toEqual({ prefix: 'DGX Spark', n: 12 })
    expect(splitSeries('node-07')).toEqual({ prefix: 'node', n: 7 })
    expect(splitSeries('web_2')).toEqual({ prefix: 'web', n: 2 })
  })
  it('does not take versions or long numbers for a series', () => {
    expect(splitSeries('Ubuntu 26.04')).toBeNull()
    expect(splitSeries('Ubuntu 26.04 5090')).toBeNull()
    expect(splitSeries('Ubuntu 26 US')).toBeNull()
    expect(splitSeries('12')).toBeNull()
    expect(splitSeries('')).toBeNull()
  })
})

describe('automatic groups', () => {
  const hosts = [h('AI TOP ATOM 1'), h('AI TOP ATOM 0'), h('DGX Spark 0'), h('Rocky 10'), h('ai top atom 2')]
  it('needs two hosts with the same prefix, ignoring case', () => {
    const m = autoGroupNames(hosts)
    expect([...m.keys()].sort()).toEqual(['ai top atom'])
    expect(m.get('ai top atom')).toBe('AI TOP ATOM')
  })
  it('puts only the members in the group, and nothing when switched off', () => {
    const on = effectiveGroups(hosts, true).map((g) => g.group)
    expect(on).toEqual(['AI TOP ATOM', 'AI TOP ATOM', '', '', 'AI TOP ATOM'])
    expect(effectiveGroups(hosts, false).every((g) => g.group === '')).toBe(true)
  })
  it('leaves a host the user decided about alone, both ways', () => {
    const list = [h('A 1'), h('A 2'), h('A 3', { groupLocked: true }), h('A 4', { group: 'Mine' })]
    const g = effectiveGroups(list, true)
    expect(g.map((x) => x.group)).toEqual(['A', 'A', '', 'Mine'])
    expect(g.map((x) => x.auto)).toEqual([true, true, false, false])
  })
  it('a locked or grouped host does not count towards the two', () => {
    const list = [h('B 1'), h('B 2', { groupLocked: true })]
    expect(effectiveGroups(list, true).every((x) => x.group === '')).toBe(true)
  })
})

describe('odd data', () => {
  it('a group or label that is not a string does not throw', () => {
    const bad = [h('X 1', { group: 5 as unknown as string }), h(42 as unknown as string), h('X 2')]
    expect(() => buildGroups(bad, { sort: 'name', autoOn: true, ungroupedLabel: '未分组' })).not.toThrow()
    expect(splitSeries(null as unknown as string)).toBeNull()
  })
})

describe('sorting', () => {
  it('name is natural: 0 1 2 10, not 0 1 10 2', () => {
    const l = [h('X 10'), h('X 2'), h('X 0'), h('X 1')].sort(compareHosts('name'))
    expect(l.map((x) => x.label)).toEqual(['X 0', 'X 1', 'X 2', 'X 10'])
  })
  it('custom follows order, hosts without one come last by name', () => {
    const l = [h('C'), h('B', { order: 1 }), h('A', { order: 0 }), h('D')].sort(compareHosts('custom'))
    expect(l.map((x) => x.label)).toEqual(['A', 'B', 'C', 'D'])
  })
  it('recent is newest first', () => {
    const l = [h('o', { lastUsedAt: 1 }), h('n', { lastUsedAt: 9 })].sort(compareHosts('recent'))
    expect(l.map((x) => x.label)).toEqual(['n', 'o'])
  })
})

describe('buildGroups', () => {
  const hosts = [h('AI 1'), h('AI 0'), h('DGX 0'), h('DGX 1'), h('Solo')]
  const o = { sort: 'name' as const, autoOn: true, ungroupedLabel: '未分组' }
  it('named groups A→Z, ungrouped last, hosts inside by sort', () => {
    const g = buildGroups(hosts, o)
    expect(g.map((x) => x.name)).toEqual(['AI', 'DGX', '未分组'])
    expect(g[0].hosts.map((x) => x.label)).toEqual(['AI 0', 'AI 1'])
    expect(g[0].auto).toBe(true)
    expect(g[2].auto).toBe(false)
  })
  it('a group with one hand-placed member is not "auto"', () => {
    const g = buildGroups([h('AI 1', { group: 'AI' }), h('AI 0')], o)
    expect(g[0].auto).toBe(false)
  })
  it('groups that differ only in case are one group', () => {
    const g = buildGroups([h('P 1', { group: 'Prod' }), h('P 2', { group: 'prod' })], o)
    expect(g).toHaveLength(1)
    expect(g[0].hosts).toHaveLength(2)
  })
  it('custom sort uses the stored group order, new groups after it', () => {
    const g = buildGroups(hosts, { ...o, sort: 'custom', groupOrder: ['DGX'] })
    expect(g.map((x) => x.name)).toEqual(['DGX', 'AI', '未分组'])
  })
})

describe('patches', () => {
  it('sets, clears and locks, ignoring unknown ids and bad values', () => {
    const a = h('a', { group: 'Old', order: 3 })
    const b = h('b')
    const out = applyHostPatches([a, b], [
      { id: a.id, group: '', groupLocked: true, order: null },
      { id: b.id, group: '  Prod  ', order: Number.NaN },
      { id: 'nope', group: 'X' }
    ])
    expect(out[0].group).toBeUndefined()
    expect(out[0].groupLocked).toBe(true)
    expect(out[0].order).toBeUndefined()
    expect(out[1].group).toBe('Prod')
    expect(out[1].order).toBeUndefined()
    expect(out).toHaveLength(2)
  })
  it('caps the group name length', () => {
    const a = h('a')
    expect(applyHostPatches([a], [{ id: a.id, group: 'x'.repeat(200) }])[0].group).toHaveLength(40)
  })
  it('does not touch the input', () => {
    const a = h('a')
    applyHostPatches([a], [{ id: a.id, group: 'G' }])
    expect(a.group).toBeUndefined()
  })
})

describe('reordering', () => {
  it('inserts before a target, or at the end', () => {
    expect(insertBefore(['a', 'b', 'c', 'd'], ['d'], 'b')).toEqual(['a', 'd', 'b', 'c'])
    expect(insertBefore(['a', 'b', 'c'], ['a'], null)).toEqual(['b', 'c', 'a'])
    expect(insertBefore(['a', 'b', 'c'], ['x'], 'c')).toEqual(['a', 'b', 'x', 'c'])
    expect(insertBefore(['a', 'b'], ['a', 'b'], null)).toEqual(['a', 'b'])
  })
  it('numbers the list; only the moved hosts are locked into the group', () => {
    expect(patchesForOrder(['x', 'y', 'z'], 'G', ['y'])).toEqual([
      { id: 'x', order: 0 },
      { id: 'y', group: 'G', groupLocked: true, order: 1 },
      { id: 'z', order: 2 }
    ])
  })
  it('moves a group name', () => {
    expect(reorderGroupNames(['A', 'B', 'C'], 'C', 'A')).toEqual(['C', 'A', 'B'])
    expect(reorderGroupNames(['A', 'B', 'C'], 'A', null)).toEqual(['B', 'C', 'A'])
  })
})
