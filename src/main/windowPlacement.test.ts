import { describe, expect, it } from 'vitest'
import { displayIdForBounds, pickWindowPlacement, type DisplayInfo } from './windowPlacement'

/**
 * The window used to open centred on whichever display the pointer was on, and
 * never remembered its position — so a launch with the pointer resting on a
 * second monitor put the window there, with no way to keep it on the main one.
 *
 * These pin the placement rules, including the cases that only show up on real
 * desks: a monitor unplugged since last time, a resolution change, and a
 * display arranged to the left of the primary (negative x).
 */

const primary: DisplayInfo = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }
// Second monitor to the right, with a taskbar on the left edge so y starts at 0
// but the height differs — realistic and easy to confuse with the primary.
const right: DisplayInfo = { id: 2, workArea: { x: 1920, y: 0, width: 2560, height: 1400 } }
// Monitor arranged to the LEFT of the primary: negative origin.
const left: DisplayInfo = { id: 3, workArea: { x: -1920, y: 0, width: 1920, height: 1040 } }

const ctx = (displays: DisplayInfo[], cursor = { x: 100, y: 100 }) => ({
  displays,
  primaryId: 1,
  cursor
})

describe('first run (nothing saved)', () => {
  it('centres on the display under the pointer', () => {
    const p = pickWindowPlacement(undefined, ctx([primary, right], { x: 2500, y: 500 }))
    expect(p.workArea).toEqual(right.workArea)
    expect(p.x).toBeUndefined() // undefined = let the caller centre
  })

  it('falls back to the primary when the pointer is on no display', () => {
    // Cursor can sit off every display briefly while monitors re-enumerate.
    const p = pickWindowPlacement(undefined, ctx([primary, right], { x: 99999, y: 99999 }))
    expect(p.workArea).toEqual(primary.workArea)
  })

  it('handles a display with a negative origin', () => {
    const p = pickWindowPlacement(undefined, ctx([primary, left], { x: -500, y: 300 }))
    expect(p.workArea).toEqual(left.workArea)
  })
})

describe('restoring a saved position', () => {
  it('reopens exactly where it was closed', () => {
    const p = pickWindowPlacement(
      { x: 2600, y: 300, width: 1400, height: 900, displayId: 2 },
      ctx([primary, right])
    )
    expect(p.x).toBe(2600)
    expect(p.y).toBe(300)
    expect(p.workArea).toEqual(right.workArea)
  })

  it('stays on the second monitor even when the pointer is on the primary', () => {
    // This is the reported bug: a window that lived on the second monitor moved
    // back to wherever the pointer happened to be.
    const p = pickWindowPlacement(
      { x: 2600, y: 300, width: 1400, height: 900, displayId: 2 },
      ctx([primary, right], { x: 10, y: 10 })
    )
    expect(p.x).toBe(2600)
  })

  it('centres on the remembered display when that monitor is gone', () => {
    // Unplugged since last launch: the coordinates point at empty space.
    const p = pickWindowPlacement(
      { x: 2600, y: 300, width: 1400, height: 900, displayId: 2 },
      ctx([primary])
    )
    expect(p.x).toBeUndefined()
    expect(p.workArea).toEqual(primary.workArea)
  })

  it('re-centres when the resolution shrank and the window is mostly off-screen', () => {
    // Saved at x=1800 on a 2560-wide monitor; now that monitor is 1280 wide.
    const small: DisplayInfo = { id: 2, workArea: { x: 1920, y: 0, width: 1280, height: 1024 } }
    const p = pickWindowPlacement(
      { x: 3900, y: 300, width: 1400, height: 900, displayId: 2 },
      ctx([primary, small])
    )
    expect(p.x).toBeUndefined()
    expect(p.workArea).toEqual(small.workArea)
  })

  it('keeps a position that is still mostly visible', () => {
    // Hanging ~1/4 off the right edge: the user may well have put it there, and
    // the title bar is reachable, so it is honoured rather than moved.
    const p = pickWindowPlacement(
      { x: 1450, y: 100, width: 1000, height: 800, displayId: 1 },
      ctx([primary])
    )
    expect(p.x).toBe(1450)
  })

  it('re-centres when barely any of the window is on-screen', () => {
    // Same idea, far enough out that only a sliver remains — at that point it
    // is lost, not "placed".
    const p = pickWindowPlacement(
      { x: 1700, y: 100, width: 1000, height: 800, displayId: 1 },
      ctx([primary])
    )
    expect(p.x).toBeUndefined()
    expect(p.workArea).toEqual(primary.workArea)
  })

  it('re-centres a window that would land above every display', () => {
    // Saved while docked to a monitor stacked above this laptop. The title bar
    // is now off-screen: plenty of pixels visible, no way to drag it back.
    const p = pickWindowPlacement(
      { x: 100, y: -1000, width: 1200, height: 800, displayId: 1 },
      ctx([primary, right])
    )
    expect(p.x).toBeUndefined()
    expect(p.workArea).toEqual(primary.workArea)
  })

  it('falls back to the primary when the remembered display no longer exists', () => {
    const p = pickWindowPlacement(
      { x: -1800, y: 100, width: 1200, height: 800, displayId: 3 },
      ctx([primary])
    )
    expect(p.workArea).toEqual(primary.workArea)
    expect(p.x).toBeUndefined()
  })

  it('treats a missing position as a first run', () => {
    // Installs from before the position was saved only have width/height.
    const p = pickWindowPlacement({ width: 1400, height: 900 }, ctx([primary, right], { x: 2500, y: 500 }))
    expect(p.x).toBeUndefined()
    expect(p.workArea).toEqual(right.workArea)
  })
})

describe('displayIdForBounds', () => {
  it('reports the display the window centre is on', () => {
    expect(displayIdForBounds([primary, right], 1, { x: 2600, y: 300, width: 1400, height: 900 })).toBe(2)
    expect(displayIdForBounds([primary, right], 1, { x: 100, y: 100, width: 1400, height: 900 })).toBe(1)
  })

  it('falls back to the primary for bounds on no display', () => {
    expect(displayIdForBounds([primary], 1, { x: -5000, y: -5000, width: 400, height: 300 })).toBe(1)
  })
})