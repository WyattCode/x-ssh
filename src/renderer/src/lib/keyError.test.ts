import { describe, expect, it } from 'vitest'
import { keyErrorMessage } from './keyError'

/** Stand-in for the i18n `t()`: the key itself is enough to assert on. */
const t = (k: string): string => `t:${k}`

describe('keyErrorMessage', () => {
  it('maps each known code to its translated message', () => {
    expect(keyErrorMessage({ code: 'invalid-key' }, t)).toBe('t:host.keyInvalid')
    expect(keyErrorMessage({ code: 'bad-id' }, t)).toBe('t:host.keyBadId')
    expect(keyErrorMessage({ code: 'no-pubkey' }, t)).toBe('t:host.keyNoPub')
    expect(keyErrorMessage({ code: 'not-ready' }, t)).toBe('t:host.keyNotReady')
  })

  it('prefers the code over a raw error', () => {
    expect(keyErrorMessage({ code: 'bad-id', error: 'raw' }, t)).toBe('t:host.keyBadId')
  })

  it('falls back to the raw error for an unknown code', () => {
    expect(keyErrorMessage({ code: 'something-else', error: 'boom' }, t)).toBe('boom')
  })

  it('falls back to the raw error when there is no code', () => {
    expect(keyErrorMessage({ error: 'boom' }, t)).toBe('boom')
  })

  it('falls back to the generic failure when there is nothing at all', () => {
    expect(keyErrorMessage({}, t)).toBe('t:host.keyOpFail')
    expect(keyErrorMessage({ error: '' }, t)).toBe('t:host.keyOpFail')
  })
})
