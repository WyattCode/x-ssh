import { describe, expect, it } from 'vitest'
import { allPausedFlag, prunePaused, toggleId } from './transferPause'

describe('toggleId', () => {
  it('adds without mutating the original set', () => {
    const before = new Set<string>()
    const after = toggleId(before, 'a', true)
    expect([...after]).toEqual(['a'])
    expect(before.size).toBe(0)
    expect(after).not.toBe(before)
  })

  it('removes without mutating the original set', () => {
    const before = new Set(['a', 'b'])
    const after = toggleId(before, 'a', false)
    expect([...after]).toEqual(['b'])
    expect([...before]).toEqual(['a', 'b'])
  })

  it('is idempotent in both directions', () => {
    const s = new Set(['a'])
    expect([...toggleId(s, 'a', true)]).toEqual(['a'])
    expect([...toggleId(s, 'b', false)]).toEqual(['a'])
  })
})

describe('allPausedFlag', () => {
  it('is false when nothing is running', () => {
    expect(allPausedFlag([], new Set(['a']))).toBe(false)
    expect(allPausedFlag([], new Set())).toBe(false)
  })

  it('is true only when every active row is paused', () => {
    expect(allPausedFlag(['a', 'b'], new Set(['a', 'b']))).toBe(true)
    expect(allPausedFlag(['a', 'b'], new Set(['a']))).toBe(false)
    expect(allPausedFlag(['a', 'b'], new Set())).toBe(false)
  })

  it('ignores paused ids that are no longer active', () => {
    expect(allPausedFlag(['a'], new Set(['a', 'z']))).toBe(true)
  })
})

describe('prunePaused', () => {
  it('returns the same set when nothing is stale', () => {
    const s = new Set(['a'])
    expect(prunePaused(s, ['a', 'b'])).toBe(s)
  })

  it('drops ids that left the active list', () => {
    const s = new Set(['a', 'b'])
    const next = prunePaused(s, ['b'])
    expect([...next]).toEqual(['b'])
    expect([...s]).toEqual(['a', 'b'])
  })

  it('empties out when nothing is active any more', () => {
    expect(prunePaused(new Set(['a', 'b']), []).size).toBe(0)
  })
})
