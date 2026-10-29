import { describe, expect, it } from 'vitest'
import { shouldReleaseZoomHover } from './zoomHud'

describe('shouldReleaseZoomHover', () => {
  it('keeps the hover while the window is visible and focused', () => {
    expect(shouldReleaseZoomHover('visible', false)).toBe(false)
  })

  it('releases the hover when the document is hidden', () => {
    expect(shouldReleaseZoomHover('hidden', false)).toBe(true)
  })

  it('releases the hover when the window is blurred', () => {
    expect(shouldReleaseZoomHover('visible', true)).toBe(true)
  })

  it('releases the hover when hidden and blurred', () => {
    expect(shouldReleaseZoomHover('hidden', true)).toBe(true)
  })
})
