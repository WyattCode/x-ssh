// Pure-function tests only — deliberately no import of 'electron' or './index'
// (that would drag the whole main process into the test).
import { describe, expect, it } from 'vitest'
import { macLightPosition } from './macLights'

describe('macLightPosition', () => {
  it('hands the lights to the OS at 100 %', () => {
    expect(macLightPosition(1)).toBeNull()
  })
  it('hands the lights to the OS for a bad factor', () => {
    expect(macLightPosition(NaN)).toBeNull()
    expect(macLightPosition(0)).toBeNull()
    expect(macLightPosition(-1)).toBeNull()
    expect(macLightPosition(Infinity)).toBeNull()
  })
  it('hands the lights to the OS within sub-pixel tolerance of the default line', () => {
    expect(macLightPosition((18.8 + 0.01) / 20)).toBeNull()
    expect(macLightPosition((18.8 - 0.01) / 20)).toBeNull()
  })
  it('returns the absolute inset onto the zoomed band centre', () => {
    // setWindowButtonPosition takes an absolute inset from the window's
    // top-left, so assert the full position, never an offset: at 120 % the
    // band centre is 24 pt, hence y = 13.05 + (24 − 18.8) = 18.25.
    expect(macLightPosition(1.2)).toEqual({ x: 13.0, y: 18.25 })
    expect(macLightPosition(2)).toEqual({ x: 13.0, y: 34.25 })
    expect(macLightPosition(0.5)).toEqual({ x: 13.0, y: 4.25 })
  })
  it('never moves the lights sideways', () => {
    for (const f of [0.5, 0.7, 1.2, 1.5, 2, 2.5]) {
      expect(macLightPosition(f)?.x).toBe(13.0)
    }
  })
})
