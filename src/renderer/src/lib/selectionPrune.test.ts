import { describe, expect, it } from 'vitest'
import { pruneSelection } from './selectionPrune'

describe('pruneSelection', () => {
  it('returns the same Set when nothing is selected', () => {
    const sel = new Set<string>()
    expect(pruneSelection(sel, ['a', 'b'])).toBe(sel)
  })

  it('returns the same Set when every selected name is still shown', () => {
    const sel = new Set(['a', 'b'])
    expect(pruneSelection(sel, ['a', 'b', 'c'])).toBe(sel)
  })

  it('drops names that are no longer shown', () => {
    const sel = new Set(['a', 'b'])
    const next = pruneSelection(sel, ['a', 'c'])
  it('returns the same Set when `shown` is a Set that still holds everything', () => {
    const sel = new Set(['a'])
    expect(pruneSelection(sel, new Set(['a', 'b']))).toBe(sel)
  })

  it('drops a name that is gone, leaving the rest', () => {
    const sel = new Set(['a', 'b'])
    const next = pruneSelection(sel, ['a'])
    expect(next).not.toBe(sel)
    expect([...next]).toEqual(['a'])
  })

  it('clears the selection when nothing is shown', () => {
    const sel = new Set(['a', 'b'])
    const next = pruneSelection(sel, [])
  it('clears everything when nothing is shown', () => {
    const sel = new Set(['a', 'b'])
    const next = pruneSelection(sel, [])
    expect(next).not.toBe(sel)
    expect(next.size).toBe(0)
  })
})
