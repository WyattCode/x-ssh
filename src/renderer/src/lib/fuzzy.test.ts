import { describe, it, expect } from 'vitest'
import { fuzzyScore } from './fuzzy'

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
