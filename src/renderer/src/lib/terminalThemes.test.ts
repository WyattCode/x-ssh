import { describe, expect, it } from 'vitest'
import { PRESETS, PRESET_BY_ID, themeFor } from './terminalThemes'

describe('terminalThemes', () => {
  it('exposes the six desktop preset ids', () => {
    expect(PRESETS.map((p) => p.id)).toEqual([
      'nord',
      'dracula',
      'solarized',
      'one-dark',
      'gruvbox',
      'monokai'
    ])
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(6)
  })

  it('keeps desktop labels', () => {
    expect(PRESET_BY_ID.nord.label).toBe('Nord')
    expect(PRESET_BY_ID.dracula.label).toBe('Dracula')
    expect(PRESET_BY_ID.solarized.label).toBe('Solarized Dark')
    expect(PRESET_BY_ID['one-dark'].label).toBe('One Dark')
    expect(PRESET_BY_ID.gruvbox.label).toBe('Gruvbox Dark')
    expect(PRESET_BY_ID.monokai.label).toBe('Monokai')
  })

  it('themeFor picks presets and falls back to system', () => {
    expect(themeFor('dark', 'nord').background).toBe('#2e3440')
    expect(themeFor('light', '').background).toBe('#f7f8fa')
    expect(themeFor('dark', '').background).toBe('#0e0f12')
    expect(themeFor('dark', 'missing').background).toBe('#0e0f12')
  })

  it('fills bright* so xterm gets a full 16-color theme', () => {
    for (const p of PRESETS) {
      const c = p.palette
      expect(c.brightRed).toBe(c.red)
      expect(c.brightGreen).toBe(c.green)
      expect(c.brightYellow).toBe(c.yellow)
      expect(c.brightBlue).toBe(c.blue)
      expect(c.brightMagenta).toBe(c.magenta)
      expect(c.brightCyan).toBe(c.cyan)
      expect(c.brightWhite).toBe(c.white)
      expect(c.brightBlack).toBeTruthy()
    }
    const dark = themeFor('dark')
    expect(dark.brightRed).toBe(dark.red)
    expect(dark.brightWhite).toBe(dark.white)
  })
})
