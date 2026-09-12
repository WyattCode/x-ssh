import { describe, it, expect, afterEach, vi } from 'vitest'
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

/** Re-imports the module with `window.api.platform` stubbed, since `isMac` is
 *  resolved once at module load. */
async function loadFor(platform?: string): Promise<typeof import('./shortcuts')> {
  vi.resetModules()
  if (platform === undefined) {
    // Node has no window; that is what the unit-test environment looks like.
    delete (globalThis as { window?: unknown }).window
  } else {
    ;(globalThis as { window?: unknown }).window = { api: { platform } }
  }
  return import('./shortcuts')
}

describe('defaults per platform', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window
  })

  it('keeps the Ctrl-based defaults off macOS', async () => {
    const { DEFAULT_BINDINGS: d } = await loadFor('win32')
    expect(d.split).toBe('Mod+Shift+D')
    expect(d.splitCol).toBe('Mod+Shift+\\')
    expect(d.focus).toBe('Mod+Shift+O')
    expect(d.nextTab).toBe('Ctrl+Tab')
  })

  it('uses the macOS terminal conventions on macOS', async () => {
    const { DEFAULT_BINDINGS: d } = await loadFor('darwin')
    expect(d.split).toBe('Mod+D')
    expect(d.splitCol).toBe('Mod+Shift+D')
    expect(d.focus).toBe('Mod+]')
    expect(d.nextTab).toBe('Mod+Alt+ArrowRight')
    expect(d.prevTab).toBe('Mod+Alt+ArrowLeft')
  })

  it('leaves every Ctrl combo to the shell on macOS', async () => {
    const { DEFAULT_BINDINGS: d } = await loadFor('darwin')
    const ctrlBound = Object.values(d).filter((chord) => chord.split('+').includes('Ctrl'))
    expect(ctrlBound).toEqual([])
  })

  it.each([undefined, 'darwin'])('binds no chord twice (platform: %s)', async (platform) => {
    const m = await loadFor(platform)
    const seen = m.REBINDABLE_ACTIONS.map((a) =>
      m.canonicalChord(m.DEFAULT_BINDINGS[a], platform === 'darwin')
    )
    expect(new Set(seen).size).toBe(seen.length)
  })
})

describe('macOS chords', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window
  })

  it('matches Cmd+D but not Cmd+Shift+D', async () => {
    const m = await loadFor('darwin')
    expect(m.chordMatches(ev({ metaKey: true, key: 'd' }), 'Mod+D')).toBe(true)
    // The extra-modifier check is what keeps split and splitCol apart.
    expect(m.chordMatches(ev({ metaKey: true, shiftKey: true, key: 'D' }), 'Mod+D')).toBe(false)
    expect(m.chordMatches(ev({ metaKey: true, shiftKey: true, key: 'D' }), 'Mod+Shift+D')).toBe(true)
  })

  it('matches Option+Cmd+Arrow for tab navigation', async () => {
    const m = await loadFor('darwin')
    const e = ev({ metaKey: true, altKey: true, key: 'ArrowRight' })
    expect(m.chordMatches(e, 'Mod+Alt+ArrowRight')).toBe(true)
    expect(m.chordMatches(e, 'Mod+Alt+ArrowLeft')).toBe(false)
  })

  it('cannot express a shifted bracket, which is why arrows are used', async () => {
    const m = await loadFor('darwin')
    // Shift+"]" reports e.key "}", so the literal chord never matches...
    expect(m.chordMatches(ev({ metaKey: true, shiftKey: true, key: '}' }), 'Mod+Shift+]')).toBe(false)
    // ...and declaring the shifted character instead fails the extras check.
    expect(m.chordMatches(ev({ metaKey: true, shiftKey: true, key: '}' }), 'Mod+}')).toBe(false)
  })
})

describe('Option chords on macOS', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window
  })

  it('matches a recorded Option chord through the composed glyph', async () => {
    const m = await loadFor('darwin')
    // ⌥⌘D arrives as e.key "∂"; the chord stores the physical key.
    const e = ev({ metaKey: true, altKey: true, key: '∂', code: 'KeyD' })
    expect(m.chordMatches(e, 'Mod+Alt+D')).toBe(true)
    expect(m.chordMatches(e, 'Mod+Alt+F')).toBe(false)
  })

  it('does not fall back to the physical key when Option is not held', async () => {
    const m = await loadFor('darwin')
    // A dead-key glyph without Option is just that glyph, not the letter under it.
    const e = ev({ metaKey: true, key: '∂', code: 'KeyD' })
    expect(m.chordMatches(e, 'Mod+D')).toBe(false)
  })

  it('reads the letter or digit off the physical key', async () => {
    const m = await loadFor('darwin')
    expect(m.basePhysicalKey({ code: 'KeyD' } as KeyboardEvent)).toBe('D')
    expect(m.basePhysicalKey({ code: 'Digit7' } as KeyboardEvent)).toBe('7')
    expect(m.basePhysicalKey({ code: 'ArrowRight' } as KeyboardEvent)).toBe('')
    expect(m.basePhysicalKey({ code: '' } as KeyboardEvent)).toBe('')
  })
})
