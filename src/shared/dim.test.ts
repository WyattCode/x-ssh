import { describe, expect, it } from 'vitest'
import { dimHex } from './dim'

describe('dimHex', () => {
  it('darkens by the scrim opacity', () => {
    expect(dimHex('#ffffff', 0.6)).toBe('#666666')
    expect(dimHex('#eef0f3', 0.5)).toBe('#77787a')
    expect(dimHex('#000000', 0.6)).toBe('#000000')
  })
  it('leaves 0 and 1 exact and clamps the rest', () => {
    expect(dimHex('#123456', 0)).toBe('#123456')
    expect(dimHex('#123456', 1)).toBe('#000000')
    expect(dimHex('#123456', 5)).toBe('#000000')
    expect(dimHex('#123456', -1)).toBe('#123456')
  })
  it('returns anything that is not #rrggbb unchanged', () => {
    expect(dimHex('red', 0.5)).toBe('red')
    expect(dimHex('#fff', 0.5)).toBe('#fff')
  })
})
