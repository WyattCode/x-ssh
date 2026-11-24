// Pure-function tests only — deliberately no import of 'electron' or './index'
// (that would drag the whole main process into the test).
import { describe, expect, it } from 'vitest'
import { macLightPosition } from './macLights'

describe('macLightPosition', () => {
  it('returns the absolute inset onto the zoomed band centre', () => {
    // setWindowButtonPosition takes an absolute inset from the window's
    // top-left, so assert the full position, never an offset: pushed y =
    // 20 × factor − 8.0 puts the lights' centre (pushed y + 7.25) on the
    // band's visible centre line (20 × factor − 0.75).
    expect(macLightPosition(0.5)).toEqual({ x: 13.0, y: 2.0 })
    expect(macLightPosition(1.2)).toEqual({ x: 13.0, y: 16.0 })
    expect(macLightPosition(2)).toEqual({ x: 13.0, y: 32.0 })
    expect(macLightPosition(2.5)).toEqual({ x: 13.0, y: 42.0 })
  })
  it('pushes the lights onto the band centre at 100 % too', () => {
    // 100 % no longer hands the lights to the OS default (centre 13.5 pt,
    // 5.75 pt above this step's 19.25 pt line) — that jump around 100 % was
    // the bug; the step goes through the same formula now.
    expect(macLightPosition(1)).toStrictEqual({ x: 13.0, y: 12.0 })
  })
  it('hands the lights to the OS only for a bad factor', () => {
    expect(macLightPosition(NaN)).toBeNull()
    expect(macLightPosition(0)).toBeNull()
    expect(macLightPosition(-1)).toBeNull()
    expect(macLightPosition(Infinity)).toBeNull()
  })
  it('never moves the lights sideways, and pushes every step of the zoom ladder', () => {
    for (const f of [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 2.1, 2.2, 2.3, 2.4, 2.5]) {
      const pos = macLightPosition(f)
      expect(pos, `factor ${f}`).not.toBeNull()
      expect(pos?.x).toBe(13.0)
    }
  })
})
