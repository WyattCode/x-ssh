import { describe, expect, it } from 'vitest'
import {
  ZOOM_DEFAULT_PCT,
  ZOOM_MAX_PCT,
  ZOOM_MIN_PCT,
  levelToPercent,
  percentToLevel,
  snapLevel,
  snapPercent,
  stepPercent
} from './zoom'

describe('zoom ladder', () => {
  it('every step from min to max is a whole multiple of 10 and survives the level round trip', () => {
    for (let p = ZOOM_MIN_PCT; p <= ZOOM_MAX_PCT; p += 10) {
      expect(levelToPercent(percentToLevel(p))).toBe(p)
      expect(levelToPercent(snapLevel(percentToLevel(p)))).toBe(p)
    }
  })
  it('walking up and down only ever visits multiples of 10', () => {
    let p = ZOOM_DEFAULT_PCT
    for (let i = 0; i < 30; i++) {
      p = stepPercent(p, 1)
      expect(p % 10).toBe(0)
    }
    expect(p).toBe(ZOOM_MAX_PCT)
    for (let i = 0; i < 30; i++) {
      p = stepPercent(p, -1)
      expect(p % 10).toBe(0)
    }
    expect(p).toBe(ZOOM_MIN_PCT)
  })
  it('moves old half-level values (131 %, 144 %, 91 %) onto the ladder', () => {
    expect(levelToPercent(snapLevel(1.5))).toBe(130)
    expect(levelToPercent(snapLevel(2))).toBe(140)
    expect(levelToPercent(snapLevel(-0.5))).toBe(90)
    expect(levelToPercent(snapLevel(0))).toBe(100)
  })
  it('clamps and survives garbage', () => {
    expect(snapPercent(9999)).toBe(ZOOM_MAX_PCT)
    expect(snapPercent(-5)).toBe(ZOOM_MIN_PCT)
    expect(snapPercent(Number.NaN)).toBe(ZOOM_DEFAULT_PCT)
    expect(levelToPercent(snapLevel(Number.POSITIVE_INFINITY))).toBe(ZOOM_DEFAULT_PCT)
    expect(levelToPercent(snapLevel('x' as unknown as number))).toBe(ZOOM_DEFAULT_PCT)
  })
})
