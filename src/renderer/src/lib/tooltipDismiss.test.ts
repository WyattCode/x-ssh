import { describe, it, expect } from 'vitest'
import { shouldDismissTooltip } from './tooltipDismiss'

describe('shouldDismissTooltip', () => {
  it('keeps the tip while the window is visible and focused', () => {
    expect(shouldDismissTooltip('visible', false)).toBe(false)
  })

  it('dismisses when the document is hidden', () => {
    expect(shouldDismissTooltip('hidden', false)).toBe(true)
  })

  it('dismisses when the window lost focus (Alt-Tab)', () => {
    expect(shouldDismissTooltip('visible', true)).toBe(true)
  })

  it('dismisses when hidden and blurred', () => {
    expect(shouldDismissTooltip('hidden', true)).toBe(true)
  })
})
