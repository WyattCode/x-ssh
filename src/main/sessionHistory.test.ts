import { describe, expect, it } from 'vitest'
import {
  HISTORY_ENTRY_BYTES,
  TRUNCATION_MARK,
  capHistory,
  trimEntry
} from './sessionHistory'

const bytes = (s: string): number => Buffer.byteLength(s, 'utf8')

/**
 * Real numbers from this machine before the fix: 142 saved sessions, 30 MB of
 * text, median entry 327 KB. The cap was `slice(-300)`, i.e. ~100 MB, and
 * settings.json is rewritten whole on every settings write.
 */
describe('trimEntry', () => {
  it('leaves a small buffer untouched', () => {
    const s = 'hello'
    expect(trimEntry(s)).toBe(s)
  })

  it('keeps the tail, which is the newest output', () => {
    const s = 'A'.repeat(1000) + 'NEWEST'
    const out = trimEntry(s, 100)
    expect(out.endsWith('NEWEST')).toBe(true)
    expect(out.startsWith(TRUNCATION_MARK)).toBe(true)
  })

  it('respects the byte budget with multi-byte characters', () => {
    // Chinese is 3 bytes per char in UTF-8; a char-based cap would overshoot.
    const s = '中'.repeat(5000)
    const out = trimEntry(s, 300)
    expect(bytes(out)).toBeLessThanOrEqual(300)
  })

  it('never splits below a byte to satisfy the budget', () => {
    const out = trimEntry('中'.repeat(100), 5)
    expect(out).toContain(TRUNCATION_MARK)
    // Trimmed to nothing rather than emitting a broken code unit.
    expect(() => Buffer.from(out, 'utf8').toString('utf8')).not.toThrow()
  })
})

describe('capHistory', () => {
  const entry = (n: number, size = 1000): { label: string; text: string } => ({
    label: `h${n}`,
    text: String(n).padStart(4, '0') + 'x'.repeat(size)
  })

  it('keeps chronological order', () => {
    const kept = capHistory([entry(1), entry(2), entry(3)], 1_000_000)
    expect(kept.map((e) => e.label)).toEqual(['h1', 'h2', 'h3'])
  })

  it('drops the oldest, not the newest, when over budget', () => {
    const kept = capHistory([entry(1), entry(2), entry(3), entry(4)], 2500)
    expect(kept.map((e) => e.label)).toEqual(['h3', 'h4'])
  })

  it('stays within the budget', () => {
    const many = Array.from({ length: 100 }, (_, i) => entry(i, 10_000))
    const kept = capHistory(many, 100_000)
    const used = kept.reduce((n, e) => n + bytes(e.text) + bytes(e.label), 0)
    expect(used).toBeLessThanOrEqual(100_000)
  })

  it('always keeps the newest entry even if it alone exceeds the budget', () => {
    // An empty history would lose the search entirely; the per-entry cap
    // (64 KB) is what actually bounds this.
    const kept = capHistory([entry(1)], 10)
    expect(kept).toHaveLength(1)
    expect(kept[0].label).toBe('h1')
  })

  it('caps a single fat entry rather than letting it through', () => {
    const fat = { label: 'big', text: 'y'.repeat(500_000) }
    const kept = capHistory([fat], 2_000_000)
    expect(bytes(kept[0].text)).toBeLessThanOrEqual(HISTORY_ENTRY_BYTES)
  })

  it('bounds the total: 200 entries of 64 KB cannot reach 100 MB', () => {
    // The old count-only cap allowed exactly that. Worst case now:
    const worst = Array.from({ length: 200 }, (_, i) => ({
      label: `h${i}`,
      text: 'z'.repeat(HISTORY_ENTRY_BYTES)
    }))
    const kept = capHistory(worst, 2 * 1024 * 1024)
    const used = kept.reduce((n, e) => n + bytes(e.text), 0)
    expect(used).toBeLessThanOrEqual(2 * 1024 * 1024)
  })

  it('honours the entry ceiling', () => {
    const many = Array.from({ length: 500 }, (_, i) => entry(i, 10))
    expect(capHistory(many, 10_000_000, 50)).toHaveLength(50)
  })

  it('survives an empty list', () => {
    expect(capHistory([])).toEqual([])
  })
})