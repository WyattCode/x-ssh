import { describe, it, expect } from 'vitest'
import {
  isCancelled,
  pct,
  formatBytes,
  formatSpeed,
  formatAgo,
  transferStatusText,
  CANCELLED_MARKER
} from './transferFormat'

const tr = (key: string, vars?: Record<string, number>): string =>
  vars ? `${key}:${JSON.stringify(vars)}` : key

describe('isCancelled', () => {
  it('recognises the sentinel main writes', () => {
    expect(isCancelled({ error: CANCELLED_MARKER })).toBe(true)
  })

  it('still recognises the legacy Chinese marker', () => {
    expect(isCancelled({ error: '已取消' })).toBe(true)
  })

  it('prefers the explicit flag when main provides it', () => {
    // The flag is what makes this fail-proof: the wording of the message can
    // change (or be translated) without the UI misreading a cancel as a failure.
    expect(isCancelled({ error: 'Cancelled', cancelled: true })).toBe(true)
    expect(isCancelled({ error: CANCELLED_MARKER, cancelled: false })).toBe(false)
  })

  it('does not mistake a real error for a cancellation', () => {
    expect(isCancelled({ error: 'Permission denied' })).toBe(false)
    expect(isCancelled({})).toBe(false)
    expect(isCancelled(null)).toBe(false)
    expect(isCancelled(undefined)).toBe(false)
  })
})

describe('pct', () => {
  it('computes a percentage', () => {
    expect(pct({ total: 200, transferred: 50 })).toBe(25)
    expect(pct({ total: 200, transferred: 200 })).toBe(100)
  })

  it('clamps overshoot to 100', () => {
    expect(pct({ total: 100, transferred: 150 })).toBe(100)
  })

  it('reads a finished job with no byte total as complete', () => {
    expect(pct({ total: 0, transferred: 0, done: true })).toBe(100)
    expect(pct({ total: 0, transferred: 0 })).toBe(0)
  })
})

describe('formatBytes', () => {
  it('shows whole bytes without a decimal', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
  })

  it('scales through the units', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(1024 ** 3)).toBe('1.0 GB')
  })

  it('treats negative and non-values as zero', () => {
    expect(formatBytes(-5)).toBe('0 B')
    expect(formatBytes(NaN)).toBe('0 B')
  })
})

describe('formatSpeed', () => {
  it('is empty when too slow to be worth showing', () => {
    expect(formatSpeed(0)).toBe('')
    expect(formatSpeed(undefined)).toBe('')
    expect(formatSpeed(0.4)).toBe('')
  })

  it('formats a usable rate', () => {
    expect(formatSpeed(1024)).toBe('1.0 KB/s')
  })
})

describe('formatAgo', () => {
  const now = 1_700_000_000_000

  it('picks the unit by elapsed time', () => {
    expect(formatAgo(now - 5_000, tr, now)).toBe('sfp.justNow')
    expect(formatAgo(now - 5 * 60_000, tr, now)).toBe('sfp.minAgo:{"n":5}')
    expect(formatAgo(now - 3 * 3_600_000, tr, now)).toBe('sfp.hrAgo:{"n":3}')
    expect(formatAgo(now - 2 * 86_400_000, tr, now)).toBe('sfp.dayAgo:{"n":2}')
  })

  it('treats the boundaries as the larger unit', () => {
    expect(formatAgo(now - 60_000, tr, now)).toBe('sfp.minAgo:{"n":1}')
    expect(formatAgo(now - 3_600_000, tr, now)).toBe('sfp.hrAgo:{"n":1}')
    expect(formatAgo(now - 86_400_000, tr, now)).toBe('sfp.dayAgo:{"n":1}')
  })
})

describe('transferStatusText', () => {
  it('labels a cancelled transfer as cancelled, not failed', () => {
    // The bug the shared helper fixes: one of the two copies compared against a
    // hardcoded Chinese string, so an English UI showed this as an error.
    expect(transferStatusText({ error: CANCELLED_MARKER }, tr)).toBe('sfp.cancelled')
    expect(transferStatusText({ error: 'Cancelled', cancelled: true }, tr)).toBe('sfp.cancelled')
  })

  it('maps main error codes to i18n', () => {
    expect(transferStatusText({ error: 'files-failed:3' }, tr)).toBe('sfp.filesFailed:{"n":3}')
    expect(transferStatusText({ error: 'checksum-mismatch:2' }, tr)).toBe('sfp.checksumMismatch:{"n":2}')
    expect(transferStatusText({ error: 'sync-list-failed' }, tr)).toBe('sfp.syncListFailed')
  })

  it('passes a genuine error through', () => {
    expect(transferStatusText({ error: 'No space left' }, tr)).toBe('No space left')
  })

  it('reports done and in-progress', () => {
    expect(transferStatusText({ done: true }, tr)).toBe('sfp.done')
    expect(transferStatusText({ total: 100, transferred: 40 }, tr)).toBe('40%')
  })
})