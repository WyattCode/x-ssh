import { describe, it, expect } from 'vitest'
import {
  contrastRatio,
  formatRatio,
  hexToRgb,
  luminance,
  meetsAA,
  nudgeToContrast,
  AA_NORMAL
} from './contrast'

describe('contrast math', () => {
  it('matches the WCAG pairs the theme was audited against', () => {
    // These numbers came out of the M3.195 review; if the implementation drifts,
    // they stop being the values quoted in the handover.
    expect(contrastRatio('#98a0ab', '#f7f8fa')).toBeCloseTo(2.49, 1) // old light faint
    expect(contrastRatio('#656b78', '#0e0f12')).toBeCloseTo(3.58, 1) // old dark faint
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0)
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 2)
    // The ratio does not care which side is the foreground.
    expect(contrastRatio('#6a6f77', '#f7f8fa')).toBeCloseTo(contrastRatio('#f7f8fa', '#6a6f77'), 6)
  })

  it('parses shorthand and reads junk as black', () => {
    expect(hexToRgb('#fff')).toEqual([255, 255, 255])
    expect(hexToRgb('#2c68df')).toEqual([44, 104, 223])
    expect(hexToRgb('not-a-color')).toEqual([0, 0, 0])
    expect(luminance('#000000')).toBe(0)
  })

  it('knows which shipped tokens pass', () => {
    expect(meetsAA('#6a6f77', '#f7f8fa')).toBe(true)
    expect(meetsAA('#98a0ab', '#f7f8fa')).toBe(false)
    expect(meetsAA('#828791', '#0e0f12')).toBe(true)
  })

  it('nudges a failing accent toward readable, keeping it recognizable', () => {
    // A user picking a muted blue on the DARK theme: too close to the surface to
    // work as label text. The fix must move it toward white (every channel up),
    // not swap in an unrelated color.
    const choice = '#3a5f8a'
    expect(meetsAA(choice, '#0e0f12')).toBe(false) // the premise, or this tests nothing
    const fixed = nudgeToContrast(choice, '#0e0f12')
    expect(meetsAA(fixed, '#0e0f12')).toBe(true)
    const [r0, g0, b0] = hexToRgb(choice)
    const [r1, g1, b1] = hexToRgb(fixed)
    expect(r1).toBeGreaterThan(r0)
    expect(g1).toBeGreaterThan(g0)
    expect(b1).toBeGreaterThan(b0)
  })

  it('solves the light-theme direction too', () => {
    const choice = '#9fd8ff'
    expect(meetsAA(choice, '#f7f8fa')).toBe(false)
    const fixed = nudgeToContrast(choice, '#f7f8fa')
    expect(meetsAA(fixed, '#f7f8fa')).toBe(true)
    // On a light background the nudge goes toward black.
    const [r, g, b] = hexToRgb(fixed)
    const [r0, g0, b0] = hexToRgb(choice)
    expect(r).toBeLessThan(r0)
    expect(g).toBeLessThan(g0)
    expect(b).toBeLessThan(b0)
  })

  it('leaves a passing color exactly as picked', () => {
    // Silent repaints of a deliberate choice are worse than the warning.
    expect(nudgeToContrast('#6ea8fe', '#0e0f12')).toBe('#6ea8fe')
    expect(nudgeToContrast('#6a6f77', '#f7f8fa')).toBe('#6a6f77')
    expect(nudgeToContrast('#2c68df', '#f7f8fa')).toBe('#2c68df')
  })

  it('exposes the floor and a display string', () => {
    expect(AA_NORMAL).toBe(4.5)
    expect(formatRatio(4.512)).toBe('4.5:1')
    expect(formatRatio(2.49)).toBe('2.5:1')
  })
})
