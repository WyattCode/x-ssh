import { describe, expect, it } from 'vitest'
import { pasteLineCount } from './pasteLines'

describe('pasteLineCount', () => {
  it('counts empty and newline-only text as 0', () => {
    expect(pasteLineCount('')).toBe(0)
    expect(pasteLineCount('\n')).toBe(0)
    expect(pasteLineCount('\r\n')).toBe(0)
  })

  it('counts a single line as 1', () => {
    expect(pasteLineCount('hello')).toBe(1)
  })

  it('ignores a trailing newline on a single line', () => {
    expect(pasteLineCount('hello\n')).toBe(1)
    expect(pasteLineCount('hello\r\n')).toBe(1)
  })

  it('counts multiple lines', () => {
    expect(pasteLineCount('a\nb')).toBe(2)
    expect(pasteLineCount('a\nb\n')).toBe(2)
    expect(pasteLineCount('a\n\nb')).toBe(3)
    expect(pasteLineCount('a\r\nb\r\n')).toBe(2)
  })
})
