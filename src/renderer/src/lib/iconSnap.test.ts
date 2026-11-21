import { describe, expect, it } from 'vitest'
import { snapIcon } from './iconSnap'

describe('snapIcon', () => {
  const dprs = [1, 1.25, 1.5, 1.8, 2, 2.1, 2.5, 3]
  it('the box and stroke are whole device pixels, the box has the stroke\'s parity, and it stays close to the size asked for', () => {
    for (const dpr of dprs) {
      for (let w = 8; w <= 40; w += 0.7) {
        for (const stroke of [0.8, 1, 1.3, 1.7]) {
          const s = snapIcon(w, stroke, dpr)
          expect(Number.isInteger(s.boxDev)).toBe(true)
          expect(Number.isInteger(s.strokeDev)).toBe(true)
          expect(s.strokeDev).toBeGreaterThanOrEqual(1)
          expect(s.boxDev % 2).toBe(s.strokeDev % 2)
          expect(Math.abs(s.boxDev - w * dpr)).toBeLessThanOrEqual(1.0001)
          expect(Math.abs(s.boxCss * dpr - s.boxDev)).toBeLessThan(1e-9)
          expect(Math.abs((s.strokeUnits * s.boxDev) / 24 - s.strokeDev)).toBeLessThan(1e-9)
        }
      }
    }
  })
  it('at 1.8 device pixels per CSS pixel a 13.3 px box with a 1.3 px stroke is 24 px with a 2 px stroke', () => {
    const s = snapIcon(13.3, 1.3, 1.8)
    expect(s.boxDev).toBe(24)
    expect(s.strokeDev).toBe(2)
  })
  it('survives a nonsense ratio', () => {
    expect(snapIcon(16, 1.7, 0).boxDev).toBeGreaterThan(0)
    expect(snapIcon(16, 1.7, Number.NaN).boxDev).toBeGreaterThan(0)
  })
})
