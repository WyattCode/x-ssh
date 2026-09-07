import { describe, it, expect } from 'vitest'
import { splitShortcutChips } from './shortcutChips'

describe('splitShortcutChips', () => {
  it('splits a single chord', () => {
    expect(splitShortcutChips('Ctrl+C')).toEqual([{ chord: ['Ctrl', 'C'] }])
  })

  it('splits on the … separator with surrounding whitespace', () => {
    expect(splitShortcutChips('Mod+1 … Mod+8')).toEqual([
      { chord: ['Mod', '1'] },
      { sep: 'ellipsis' },
      { chord: ['Mod', '8'] }
    ])
  })

  it('splits on the / separator with surrounding whitespace', () => {
    expect(splitShortcutChips('Ctrl+Shift+C / Ctrl+Shift+V')).toEqual([
      { chord: ['Ctrl', 'Shift', 'C'] },
      { sep: 'or' },
      { chord: ['Ctrl', 'Shift', 'V'] }
    ])
  })

  it('handles a chord containing a literal / nowhere (keeps it whole)', () => {
    expect(splitShortcutChips('Mod+= / Mod+-')).toEqual([
      { chord: ['Mod', '='] },
      { sep: 'or' },
      { chord: ['Mod', '-'] }
    ])
  })

  it('returns nothing for an empty spec', () => {
    expect(splitShortcutChips('')).toEqual([])
  })
})
