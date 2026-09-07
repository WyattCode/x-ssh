import { describe, it, expect } from 'vitest'
import { fuzzyScore, fuzzyMatch } from './fuzzy'

describe('fuzzyScore', () => {
  it('returns 0 for empty query', () => {
    expect(fuzzyScore('', 'anything')).toBe(0)
  })

  it('returns -1 when query is not a subsequence', () => {
    expect(fuzzyScore('xyz', 'abc')).toBe(-1)
  })

  it('returns a positive score for a match', () => {
    expect(fuzzyScore('web', 'web-01')).toBeGreaterThan(0)
  })

  it('rewards consecutive matches (streak)', () => {
    const ab = fuzzyScore('ab', 'ab')
    // "a" then "b" adjacent → streak bonus makes it higher than scattered.
    expect(fuzzyScore('ab', 'a_b')).toBeLessThanOrEqual(ab)
  })

  it('rewards word-boundary / separator matches', () => {
    expect(fuzzyScore('web1', 'web-01')).toBeGreaterThan(fuzzyScore('web1', 'w-e-b-1'))
  })

  it('is case-insensitive', () => {
    expect(fuzzyScore('WEB', 'web-01')).toBe(fuzzyScore('web', 'web-01'))
  })

  it('penalizes longer overall text', () => {
    expect(fuzzyScore('ab', 'ab')).toBeGreaterThan(fuzzyScore('ab', 'ab---extra-tail'))
  })
})

describe('fuzzyMatch', () => {
  it('returns no indices for an empty query', () => {
    expect(fuzzyMatch('', 'web-01')).toEqual([])
  })

  it('returns no indices when the query is not a subsequence', () => {
    expect(fuzzyMatch('xyz', 'abc')).toEqual([])
  })

  it('returns the matched indices in order', () => {
    expect(fuzzyMatch('web', 'web-01')).toEqual([0, 1, 2])
  })

  it('spans non-consecutive characters', () => {
    expect(fuzzyMatch('wb', 'web-01')).toEqual([0, 2])
  })

  it('is case-insensitive', () => {
    expect(fuzzyMatch('WEB', 'web-01')).toEqual([0, 1, 2])
  })
})
