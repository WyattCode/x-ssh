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
describe('createOsc52Gate (B10)', () => {
  it('refuses everything while the setting is off', async () => {
    const { createOsc52Gate } = await import('./osc52')
    const gate = createOsc52Gate()
    gate.userActed(true, 1000)
    expect(gate.accept('aGk=', false, 1000)).toBeNull()
  })

  it('refuses a write the user did not just trigger', async () => {
    const { createOsc52Gate, OSC52_USER_WINDOW_MS } = await import('./osc52')
    const gate = createOsc52Gate()
    // never touched the terminal: a banner / cat-ed file cannot set the clipboard
    expect(gate.accept('aGk=', true, 1000)).toBeNull()
    gate.userActed(true, 1000)
    expect(gate.accept('aGk=', true, 1000 + OSC52_USER_WINDOW_MS + 1)).toBeNull()
  })

  it('honours a write right after a key or mouse action', async () => {
    const { createOsc52Gate, OSC52_USER_WINDOW_MS } = await import('./osc52')
    const gate = createOsc52Gate()
    gate.userActed(true, 1000)
    expect(gate.accept('aGk=', true, 1005)).toBe('hi')
    expect(gate.accept('aGk=', true, 1000 + OSC52_USER_WINDOW_MS)).toBe('hi')
  })

  it('does not drop the second of two quick copies', async () => {
    const { createOsc52Gate } = await import('./osc52')
    const gate = createOsc52Gate()
    gate.userActed(true, 1000)
    expect(gate.accept('aGk=', true, 1010)).toBe('hi')
    gate.userActed(true, 1200)
    expect(gate.accept('5L2g5aW9', true, 1210)).toBe('你好')
  })

  it('keeps the size cap', async () => {
    const { createOsc52Gate } = await import('./osc52')
    const gate = createOsc52Gate()
    gate.userActed(true, 3000)
    expect(gate.accept('a'.repeat(100_000), true, 3000)).toBeNull()
  })
  it('a key press at a plain shell prompt opens no window (Enter on `cat file`)', async () => {
    const { createOsc52Gate } = await import('./osc52')
    const gate = createOsc52Gate()
    gate.userActed(false, 1000)
    expect(gate.accept('aGk=', true, 1005)).toBeNull()
  })

  it('a plain-prompt key press does not close a window a program action opened', async () => {
    const { createOsc52Gate } = await import('./osc52')
    const gate = createOsc52Gate()
    gate.userActed(true, 1000)
    gate.userActed(false, 1100)
    expect(gate.accept('aGk=', true, 1200)).toBe('hi')
  })
})

describe('programOwnsTerminal', () => {
  it('is true on the alternate screen or with mouse tracking, false at a prompt', async () => {
    const { programOwnsTerminal } = await import('./osc52')
    expect(programOwnsTerminal({ mouseTracking: 'none', altScreen: false })).toBe(false)
    expect(programOwnsTerminal({ mouseTracking: 'none', altScreen: true })).toBe(true)
    expect(programOwnsTerminal({ mouseTracking: 'any', altScreen: false })).toBe(true)
  })
})