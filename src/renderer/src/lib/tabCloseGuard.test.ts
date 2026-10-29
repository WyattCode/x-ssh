import { describe, expect, it } from 'vitest'
import { closeAllNeedsConfirm } from './tabCloseGuard'

const tab = (...statuses: string[]): { panes: { status: string }[] } => ({
  panes: statuses.map((status) => ({ status }))
})

describe('closeAllNeedsConfirm', () => {
  it('is false when confirmClose is off, even with live panes', () => {
    expect(closeAllNeedsConfirm(false, [tab('connected')])).toBe(false)
  })

  it('is false when every pane is already closed', () => {
    expect(closeAllNeedsConfirm(true, [tab('closed'), tab('error')])).toBe(false)
  })

  it('is true when any tab has a connected pane', () => {
    expect(closeAllNeedsConfirm(true, [tab('closed'), tab('connected')])).toBe(true)
  })

  it('is false with no tabs', () => {
    expect(closeAllNeedsConfirm(true, [])).toBe(false)
  })
})
