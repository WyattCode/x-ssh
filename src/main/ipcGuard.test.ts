import { describe, expect, it } from 'vitest'
import { isTrustedFrame } from './ipcGuard'

describe('isTrustedFrame', () => {
  it('accepts the window’s own main frame', () => {
    const frame = { url: 'file:///app/out/renderer/index.html' }
    expect(isTrustedFrame(frame, frame)).toBe(true)
  })

  it('refuses another frame that happens to share the URL', () => {
    // An iframe (or a webview) inherits the origin, so comparing URLs would
    // let it through; identity is the only test that distinguishes them.
    const url = 'file:///app/out/renderer/index.html'
    expect(isTrustedFrame({ url }, { url })).toBe(false)
  })

  it('refuses a missing frame (destroyed or not yet created)', () => {
    const frame = {}
    expect(isTrustedFrame(null, frame)).toBe(false)
    expect(isTrustedFrame(undefined, frame)).toBe(false)
    expect(isTrustedFrame(frame, null)).toBe(false)
    expect(isTrustedFrame(null, null)).toBe(false)
  })

  it('is reflexively true for the same reference, even an empty one', () => {
    const frame = {}
    expect(isTrustedFrame(frame, frame)).toBe(true)
  })
})
