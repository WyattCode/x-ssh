import { describe, it, expect } from 'vitest'
import { liveForwardCount } from './forwards'

const row = (running: boolean): { running: boolean } => ({ running })

describe('liveForwardCount', () => {
  it('counts the running rows of the saved-host group matched by host id', () => {
    // Saved rules are opened by main on connect: they never appear in
    // pane.params.portForwards, so the group is the only place they show up.
    const groups = [
      { id: 'g1', host: { id: 'h1' }, rows: [row(true), row(true), row(false)] }
    ]
    expect(liveForwardCount(groups, { id: 'p1', params: { hostId: 'h1' } })).toBe(2)
  })

  it('falls back to the pane group when the pane has no host id', () => {
    // A loose (temporary) rule belongs to the pane, not to a saved host.
    const groups = [
      { id: 'p1', rows: [row(true), row(false)] },
      { id: 'p2', rows: [row(false)] }
    ]
    expect(liveForwardCount(groups, { id: 'p1', params: {} })).toBe(1)
  })

  it('returns 0 when no group matches', () => {
    const groups = [{ id: 'g1', host: { id: 'h1' }, rows: [row(true)] }]
    expect(liveForwardCount(groups, { id: 'p9', params: { hostId: 'h9' } })).toBe(0)
  })

  it('returns 0 without a pane', () => {
    expect(liveForwardCount([{ id: 'g1', rows: [row(true)] }], undefined)).toBe(0)
  })
})
