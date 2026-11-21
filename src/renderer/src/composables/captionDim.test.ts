import { describe, expect, it } from 'vitest'
import { alphaOf } from './captionDim'

describe('alphaOf', () => {
  it('reads the alpha of a computed colour', () => {
    expect(alphaOf('rgba(0, 0, 0, 0.6)')).toBe(0.6)
    expect(alphaOf('rgba(0, 0, 0, 0.45)')).toBe(0.45)
    expect(alphaOf('rgb(10 10 10 / 0.5)')).toBe(0.5)
  })
  it('an opaque colour counts as 1, a non-colour as 0', () => {
    expect(alphaOf('rgb(10, 10, 10)')).toBe(1)
    expect(alphaOf('transparent')).toBe(0)
    expect(alphaOf('rgba(0, 0, 0, 0)')).toBe(0)
    expect(alphaOf('')).toBe(0)
  })
})
