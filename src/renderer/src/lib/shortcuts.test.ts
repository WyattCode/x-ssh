import { describe, it, expect } from 'vitest'
import { chordMatches, DEFAULT_BINDINGS } from './shortcuts'

function ev(partial: Partial<KeyboardEvent>): KeyboardEvent {
  return Object.assign(
    {
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      key: ''
    },
    partial
  ) as KeyboardEvent
}

describe('chordMatches', () => {
  it('matches a simple Mod chord', () => {
    expect(chordMatches(ev({ ctrlKey: true, key: 'k' }), 'Mod+K')).toBe(true)
  })

  it('matches Mod on macOS meta key', () => {
    expect(chordMatches(ev({ metaKey: true, key: 'k' }), 'Mod+K')).toBe(true)
  })

  it('matches a Mod+Shift chord', () => {
    expect(chordMatches(ev({ ctrlKey: true, shiftKey: true, key: 'd' }), 'Mod+Shift+D')).toBe(true)
  })

  it('rejects when an extra undeclared modifier is held', () => {
    expect(chordMatches(ev({ ctrlKey: true, shiftKey: true, key: 'k' }), 'Mod+K')).toBe(false)
  })

  it('rejects when the key differs', () => {
    expect(chordMatches(ev({ ctrlKey: true, key: 'z' }), 'Mod+K')).toBe(false)
  })

  it('handles Ctrl+Tab without Mod normalization', () => {
    expect(chordMatches(ev({ ctrlKey: true, key: 'Tab' }), 'Ctrl+Tab')).toBe(true)
  })

  it('defaults to the documented chords for every rebindable action', () => {
    expect(DEFAULT_BINDINGS.settings).toBe('Mod+,')
    expect(DEFAULT_BINDINGS.splitCol).toContain('Shift')
    expect(DEFAULT_BINDINGS.palette).toBe('Mod+K')
  })
})
