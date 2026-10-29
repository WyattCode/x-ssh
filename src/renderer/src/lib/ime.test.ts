import { describe, it, expect } from 'vitest'
import { isImeKey } from './ime'

describe('isImeKey', () => {
  it('is true while a composition is in progress', () => {
    expect(isImeKey({ isComposing: true, keyCode: 13 } as KeyboardEvent)).toBe(true)
  })

  it('is true for the Chromium sentinel keyCode even without isComposing', () => {
    // Some paths clear isComposing before the handler runs but keep 229.
    expect(isImeKey({ isComposing: false, keyCode: 229 } as KeyboardEvent)).toBe(true)
  })

  it('is false for a real Enter', () => {
    expect(isImeKey({ isComposing: false, keyCode: 13 } as KeyboardEvent)).toBe(false)
  })

  it('treats a missing event as not-an-IME key', () => {
    // Handlers are also called from blur, where there is no event at all.
    expect(isImeKey(undefined)).toBe(false)
    expect(isImeKey(null)).toBe(false)
  })
})