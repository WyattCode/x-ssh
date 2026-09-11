import { describe, it, expect } from 'vitest'
import { globMatch } from './glob'

describe('globMatch', () => {
  it('matches a plain name exactly', () => {
    expect(globMatch('a.txt', 'a.txt')).toBe(true)
    expect(globMatch('a.txt', 'b.txt')).toBe(false)
  })
  it('supports * and ?', () => {
    expect(globMatch('*.log', 'server.log')).toBe(true)
    expect(globMatch('*.log', 'server.txt')).toBe(false)
    expect(globMatch('a?.txt', 'a1.txt')).toBe(true)
    expect(globMatch('a?.txt', 'a12.txt')).toBe(false)
  })
  it('supports character classes and negation', () => {
    expect(globMatch('file[0-9].txt', 'file3.txt')).toBe(true)
    expect(globMatch('file[!0-9].txt', 'filea.txt')).toBe(true)
    expect(globMatch('file[!0-9].txt', 'file3.txt')).toBe(false)
  })
  it('supports {a,b} alternation', () => {
    expect(globMatch('*.{js,ts}', 'index.ts')).toBe(true)
    expect(globMatch('*.{js,ts}', 'index.js')).toBe(true)
    expect(globMatch('*.{js,ts}', 'index.css')).toBe(false)
  })
  it('is anchored and case-sensitive', () => {
    expect(globMatch('*.txt', 'dir/a.txt')).toBe(false)
    expect(globMatch('a.txt', 'A.TXT')).toBe(false)
  })
  it('returns false on an invalid pattern instead of throwing', () => {
    expect(globMatch('[]', 'x')).toBe(false)
  })
})
