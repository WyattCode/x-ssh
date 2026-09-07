import { describe, it, expect } from 'vitest'
import {
  posixJoin,
  parentOf,
  clampConcurrency,
  shellQuoteName,
  buildPackCommand,
  buildExtractCommand,
  sanitizePasteText,
  isPrivateKey,
  sanitizeKeyName,
  shouldSkipKeyFile
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
    expect(cmd).toBe(`cd '/home/u' && tar czf '/tmp/xssh-abc.tar.gz' 'a.txt' 'b.txt'`)
  })

  it('quotes special characters in names and parent', () => {
    const cmd = buildPackCommand('/home/it/here', 't', ["it's"])
    expect(cmd).toBe(`cd '/home/it/here' && tar czf 't' 'it'\\''s'`)
  })

  it('does not shell-expand $ or backticks in parent and archive paths', () => {
    // Regression: JSON.stringify() only escaped quotes, leaving $/backticks to be
    // expanded by the remote shell. Single-quote wrapping must prevent that.
    const cmd = buildPackCommand('/home/$USER/$(pwd)', '/tmp/`id`.tar.gz', ['a.txt'])
    expect(cmd).toBe("cd '/home/$USER/$(pwd)' && tar czf '/tmp/`id`.tar.gz' 'a.txt'")
  })
})

describe('buildExtractCommand', () => {
  it('uses unzip for .zip archives', () => {
    expect(buildExtractCommand('/home/u', 'bundle.zip')).toBe("cd '/home/u' && unzip -o 'bundle.zip'")
    expect(buildExtractCommand('/home/u', 'bundle.ZIP')).toBe("cd '/home/u' && unzip -o 'bundle.ZIP'")
  })

  it('uses tar for tgz and tar.gz archives', () => {
    expect(buildExtractCommand('/home/u', 'a.tar.gz')).toBe("cd '/home/u' && tar xzf 'a.tar.gz'")
    expect(buildExtractCommand('/home/u', 'a.tgz')).toBe("cd '/home/u' && tar xzf 'a.tgz'")
  })

  it('does not shell-expand $ or backticks in archive names', () => {
    expect(buildExtractCommand('/home/u', '$(pwd).zip')).toBe("cd '/home/u' && unzip -o '$(pwd).zip'")
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

describe('isPrivateKey', () => {
  it('accepts OpenSSH / PEM private keys and Buffer input', () => {
    expect(isPrivateKey('-----BEGIN OPENSSH PRIVATE KEY-----\n...')).toBe(true)
    expect(isPrivateKey('-----BEGIN RSA PRIVATE KEY-----')).toBe(true)
    expect(isPrivateKey('-----BEGIN PRIVATE KEY-----')).toBe(true)
    expect(isPrivateKey(Buffer.from('-----BEGIN EC PRIVATE KEY-----'))).toBe(true)
  })

  it('rejects non-key text', () => {
    expect(isPrivateKey('hello world')).toBe(false)
    expect(isPrivateKey('ssh-ed25519 AAAAC...')).toBe(false)
    expect(isPrivateKey('')).toBe(false)
  })
})

describe('sanitizeKeyName', () => {
  it('replaces unsafe characters and falls back to a default', () => {
    expect(sanitizeKeyName('my-aws key')).toBe('my-aws_key')
    expect(sanitizeKeyName('../evil')).toBe('_evil')
    expect(sanitizeKeyName('')).toBe('id')
    expect(sanitizeKeyName(undefined as unknown as string)).toBe('id')
  })

  it('strips leading dots so ids are never treated as hidden/ignored files', () => {
    expect(sanitizeKeyName('.hidden')).toBe('hidden')
    expect(sanitizeKeyName('...dots')).toBe('dots')
    expect(sanitizeKeyName('.')).toBe('id')
    expect(sanitizeKeyName('..')).toBe('id')
    expect(sanitizeKeyName('id_rsa')).toBe('id_rsa')
  })
})

describe('shouldSkipKeyFile', () => {
  it('keeps generated/imported keys (id with short-uuid suffix) and plain names', () => {
    expect(shouldSkipKeyFile('id_rsa-1a2b3c4d')).toBe(false)
    expect(shouldSkipKeyFile('prod-key-01234567')).toBe(false)
    expect(shouldSkipKeyFile('my-key')).toBe(false)
  })

  it('skips hidden dotfiles and bare id_* scratch files', () => {
    expect(shouldSkipKeyFile('.hidden')).toBe(true)
    expect(shouldSkipKeyFile('id_rsa')).toBe(true)
    expect(shouldSkipKeyFile('id_ed25519')).toBe(true)
    expect(shouldSkipKeyFile('id_rsa-nouuid')).toBe(true)
  })

  it('skips companion .pub files so they are not listed as keys', () => {
    expect(shouldSkipKeyFile('my-key.pub')).toBe(true)
    expect(shouldSkipKeyFile('prod-key-01234567.pub')).toBe(true)
    expect(shouldSkipKeyFile('id_rsa-1a2b3c4d.pub')).toBe(true)
    expect(shouldSkipKeyFile('my-key-01234567.pub')).toBe(true)
  })
})
