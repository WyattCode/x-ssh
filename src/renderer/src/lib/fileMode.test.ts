import { describe, it, expect } from 'vitest'
import {
  BIT_GROUPS,
  MODE_MASK,
  clampMode,
  toOctal,
  parseOctal,
  sanitizeOctalText,
  toSymbolic
} from './fileMode'

describe('clampMode', () => {
  it('keeps the twelve permission bits', () => {
    expect(clampMode(0o7777)).toBe(0o7777)
  })

  it('drops anything above them', () => {
    // The SFTP listing carries file-type bits too; applying them as a mode
    // would be nonsense.
    expect(clampMode(0o100644)).toBe(0o644)
    expect(clampMode(0o40755)).toBe(0o755)
  })
})

describe('toOctal', () => {
  it('pads to three digits', () => {
    expect(toOctal(0o755)).toBe('755')
    expect(toOctal(0o644)).toBe('644')
    expect(toOctal(0o7)).toBe('007')
  })

  it('keeps the fourth digit when set', () => {
    expect(toOctal(0o4755)).toBe('4755')
  })

  it('clamps before formatting', () => {
    expect(toOctal(0o100644)).toBe('644')
  })
})

describe('parseOctal', () => {
  it('parses valid octal', () => {
    expect(parseOctal('755')).toBe(0o755)
    expect(parseOctal('0644')).toBe(0o644)
  })

  it('returns null for empty input rather than assuming a smash-all value', () => {
    // The dialog shows "enter a value" instead of silently applying 000.
    expect(parseOctal('')).toBeNull()
    expect(parseOctal('abc')).toBeNull()
  })

  it('drops non-octal characters', () => {
    // An `8` or `9` is not a valid permission digit; it disappears rather than
    // producing a wrong mode.
    expect(parseOctal('7x5y5')).toBe(0o755)
    expect(parseOctal('789')).toBe(0o7)
  })

  it('keeps at most four digits', () => {
    expect(parseOctal('77777')).toBe(0o7777)
  })
})

describe('sanitizeOctalText', () => {
  it('is what makes a rejected keystroke vanish', () => {
    expect(sanitizeOctalText('7a5')).toBe('75')
    expect(sanitizeOctalText('888')).toBe('')
  })

  it('agrees with parseOctal on what it accepts', () => {
    for (const raw of ['755', '0x1', '77a', '', '9999', '0644', 'abcd']) {
      const clean = sanitizeOctalText(raw)
      const parsed = parseOctal(raw)
      if (clean === '') expect(parsed, raw).toBeNull()
      else expect(parsed, raw).toBe(parseInt(clean, 8))
    }
  })
})

describe('toSymbolic', () => {
  it('renders the common modes', () => {
    expect(toSymbolic(0o755)).toBe('rwxr-xr-x')
    expect(toSymbolic(0o644)).toBe('rw-r--r--')
    expect(toSymbolic(0o600)).toBe('rw-------')
    expect(toSymbolic(0o777)).toBe('rwxrwxrwx')
    expect(toSymbolic(0o000)).toBe('---------')
  })

  it('agrees with the octal field it is shown next to', () => {
    // The dialog shows these two at once; they must never disagree.
    for (const mode of [0o755, 0o644, 0o600, 0o777, 0o000, 0o400, 0o111]) {
      expect(toOctal(parseOctal(toOctal(mode))!)).toBe(toOctal(mode))
    }
  })
})

describe('BIT_GROUPS', () => {
  it('covers every permission bit exactly once', () => {
    const masks = BIT_GROUPS.flatMap((g) => g.bits.map((b) => b.mask))
    expect(masks.length).toBe(9)
    expect(new Set(masks).size).toBe(9)
    // Together they are exactly the low nine bits.
    expect(masks.reduce((a, b) => a | b, 0)).toBe(0o777)
  })

  it('groups owner, group and other', () => {
    expect(BIT_GROUPS.map((g) => g.labelKey)).toEqual([
      'sfp.permOwner',
      'sfp.permGroup',
      'sfp.permOther'
    ])
  })

  it('stays within the managed mask', () => {
    for (const g of BIT_GROUPS) {
      for (const b of g.bits) expect(b.mask & MODE_MASK).toBe(b.mask)
    }
  })
})