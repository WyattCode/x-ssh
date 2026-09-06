import { describe, it, expect } from 'vitest'
import {
  posixJoin,
  parentOf,
  clampConcurrency,
  shellQuoteName,
  buildPackCommand,
  buildExtractCommand,
  sanitizePasteText
} from './fsUtils'

describe('posixJoin', () => {
  it('joins a dir and name', () => {
    expect(posixJoin('/home', 'file.txt')).toBe('/home/file.txt')
  })

  it('collapses trailing slashes on the dir', () => {
    expect(posixJoin('/home///', 'file.txt')).toBe('/home/file.txt')
  })

  it('joins at the root without a double slash', () => {
    expect(posixJoin('/', 'etc')).toBe('/etc')
  })
})

describe('parentOf', () => {
  it('returns the containing directory', () => {
    expect(parentOf('/home/user/file.txt')).toBe('/home/user')
    expect(parentOf('/var/log')).toBe('/var')
  })

  it('returns root for top-level entries', () => {
    expect(parentOf('/etc')).toBe('/')
    expect(parentOf('/single')).toBe('/')
  })

  it('ignores trailing slashes and returns root for the root itself', () => {
    expect(parentOf('/home/user/')).toBe('/home')
    expect(parentOf('/')).toBe('/')
  })
})

describe('clampConcurrency', () => {
  it('clamps over the maximum to 32', () => {
    expect(clampConcurrency(99, 4)).toBe(32)
  })

  it('returns the fallback for invalid values', () => {
    expect(clampConcurrency(0, 4)).toBe(4)
    expect(clampConcurrency(-5, 4)).toBe(4)
    expect(clampConcurrency(NaN, 4)).toBe(4)
    expect(clampConcurrency(Infinity, 4)).toBe(4)
  })

  it('floors fractional values', () => {
    expect(clampConcurrency(2.9, 4)).toBe(2)
  })

  it('passes valid values through', () => {
    expect(clampConcurrency(5, 4)).toBe(5)
    expect(clampConcurrency(1, 4)).toBe(1)
  })
})

describe('shellQuoteName', () => {
  it('wraps a plain name in single quotes', () => {
    expect(shellQuoteName('file.txt')).toBe("'file.txt'")
  })

  it('escapes embedded single quotes POSIX-style', () => {
    expect(shellQuoteName("it's.tar.gz")).toBe("'it'\\''s.tar.gz'")
  })
})

describe('buildPackCommand', () => {
  it('builds a tar czf command with quoted names', () => {
    const cmd = buildPackCommand('/home/u', '/tmp/xssh-abc.tar.gz', ['a.txt', 'b.txt'])
    expect(cmd).toBe(`cd "/home/u" && tar czf "/tmp/xssh-abc.tar.gz" 'a.txt' 'b.txt'`)
  })

  it('quotes special characters in names and parent', () => {
    const cmd = buildPackCommand('/home/it/here', 't', ["it's"])
    expect(cmd).toBe(`cd "/home/it/here" && tar czf "t" 'it'\\''s'`)
  })
})

describe('buildExtractCommand', () => {
  it('uses unzip for .zip archives', () => {
    expect(buildExtractCommand('/home/u', 'bundle.zip')).toBe('cd "/home/u" && unzip -o "bundle.zip"')
    expect(buildExtractCommand('/home/u', 'bundle.ZIP')).toBe('cd "/home/u" && unzip -o "bundle.ZIP"')
  })

  it('uses tar for tgz and tar.gz archives', () => {
    expect(buildExtractCommand('/home/u', 'a.tar.gz')).toBe('cd "/home/u" && tar xzf "a.tar.gz"')
    expect(buildExtractCommand('/home/u', 'a.tgz')).toBe('cd "/home/u" && tar xzf "a.tgz"')
  })
})

describe('sanitizePasteText', () => {
  it('removes C0 control sequences but keeps tabs and newlines', () => {
    const input = 'a\x1bb\x07c\td\ne'
    expect(sanitizePasteText(input)).toBe('abc\td\ne')
  })

  it('removes DEL / C1 range', () => {
    expect(sanitizePasteText('a\x7fb\x80c')).toBe('abc')
  })

  it('leaves plain text untouched', () => {
    const s = 'echo hello world'
    expect(sanitizePasteText(s)).toBe(s)
  })
})
