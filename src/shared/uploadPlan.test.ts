import { describe, expect, it } from 'vitest'
import { resumeOffset, uploadStreamOptions } from './fsUtils'

/**
 * The resume path used to corrupt files silently: `createWriteStream` was given
 * `start` without `flags`, so ssh2 kept its default 'w' (O_TRUNC), truncated the
 * remote file, and then wrote at the old offset. The result had exactly the
 * local size, so the next upload skipped it as "already synced".
 */
describe('resumeOffset', () => {
  it('resumes from the remote size when the remote copy is shorter', () => {
    expect(resumeOffset(120, 500)).toBe(120)
  })

  it('does not resume when sizes match (equal size is not equal content)', () => {
    expect(resumeOffset(500, 500)).toBe(0)
  })

  it('does not resume when the remote copy is larger', () => {
    expect(resumeOffset(900, 500)).toBe(0)
  })

  it('does not resume into an empty or missing file', () => {
    expect(resumeOffset(0, 500)).toBe(0)
    expect(resumeOffset(-1, 500)).toBe(0)
    expect(resumeOffset(Number.NaN, 500)).toBe(0)
  })
})

describe('uploadStreamOptions', () => {
  it('keeps the prefix when resuming', () => {
    const opts = uploadStreamOptions(120)
    expect(opts.flags).toBe('r+')
    expect(opts.start).toBe(120)
  })

  it('omits flags for a full write so the file is created normally', () => {
    const opts = uploadStreamOptions(0)
    expect(opts.flags).toBeUndefined()
    expect(opts.start).toBeUndefined()
  })

  it('always pins the mode instead of ssh2’s 0o666 default', () => {
    expect(uploadStreamOptions(0).mode).toBe(0o644)
    expect(uploadStreamOptions(10).mode).toBe(0o644)
  })
})
