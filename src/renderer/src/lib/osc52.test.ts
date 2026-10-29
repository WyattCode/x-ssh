import { describe, expect, it } from 'vitest'
import { decodeOsc52Payload } from './osc52'

describe('decodeOsc52Payload', () => {
  it('returns null for an empty payload', () => {
    expect(decodeOsc52Payload('')).toBeNull()
  })

  it('returns null for a query payload', () => {
    expect(decodeOsc52Payload('?')).toBeNull()
  })

  it('decodes a plain base64 payload', () => {
    expect(decodeOsc52Payload('aGk=')).toBe('hi')
  })

  it('ignores whitespace inside the base64', () => {
    expect(decodeOsc52Payload('aG\nk=')).toBe('hi')
    expect(decodeOsc52Payload(' aGk= \r\n')).toBe('hi')
    expect(decodeOsc52Payload('a G\tk =')).toBe('hi')
  })

  it('returns null for invalid base64', () => {
    expect(decodeOsc52Payload('not base64!!')).toBeNull()
  })

  it('returns null when the payload is larger than maxLen', () => {
    expect(decodeOsc52Payload('aGk=', 2)).toBeNull()
    // Whitespace is stripped before the size check, so padding can't sneak past.
    expect(decodeOsc52Payload('aG\nk=', 2)).toBeNull()
  })

  it('decodes UTF-8 text', () => {
    expect(decodeOsc52Payload('5L2g5aW9')).toBe('你好')
  })
})
