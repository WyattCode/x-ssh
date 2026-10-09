import { describe, it, expect } from 'vitest'
import { isSafeEntryName, resolveInside, resolveDir } from './localPaths'
import { join, sep } from 'node:path'

// Paths are exercised through node:path, so these expectations are
// platform-shaped. The app ships for Windows; the rules hold on both.
const dir = join('/tmp', 'xssh-base')

describe('isSafeEntryName', () => {
  it('accepts ordinary names', () => {
    for (const name of ['notes.txt', 'projects', '.gitignore', 'a b.txt', '数据.csv']) {
      expect(isSafeEntryName(name).ok, name).toBe(true)
    }
  })

  it('refuses the parent directory', () => {
    expect(isSafeEntryName('..').ok).toBe(false)
    expect(isSafeEntryName('.').ok).toBe(false)
  })

  it('refuses anything with a separator', () => {
    // These are the ones that actually escape: join(dir, '../..') walks out,
    // and join(dir, '/etc/passwd') discards dir entirely.
    for (const name of ['../..', '..\\..', 'a/b', 'a\\b', '/etc/passwd','C:\\Windows']) {
      expect(isSafeEntryName(name).ok, name).toBe(false)
    }
  })

  it('refuses empty and non-string names', () => {
    expect(isSafeEntryName('').ok).toBe(false)
    expect(isSafeEntryName(undefined).ok).toBe(false)
    expect(isSafeEntryName(null).ok).toBe(false)
    expect(isSafeEntryName(7).ok).toBe(false)
  })

  it('refuses names Windows would silently alter', () => {
    // A trailing dot or space is stripped by Win32, so the file created would
    // not be the file the user named.
    expect(isSafeEntryName('evil.', 'win32').ok).toBe(false)
    expect(isSafeEntryName('evil ', 'win32').ok).toBe(false)
    expect(isSafeEntryName('bad<name>', 'win32').ok).toBe(false)
    expect(isSafeEntryName('backup-10:30.tar', 'win32').ok).toBe(false)
  })

  it('refuses NUL on every platform', () => {
    expect(isSafeEntryName('null\u0000byte', 'win32').ok).toBe(false)
    expect(isSafeEntryName('null\u0000byte', 'linux').ok).toBe(false)
    expect(isSafeEntryName('null\u0000byte', 'darwin').ok).toBe(false)
  })

  it('accepts names that are ordinary outside Windows', () => {
    // These guard renaming and deleting existing files too. On macOS / Linux a
    // timestamped name with colons is common; refusing it would leave a file
    // the local pane lists but cannot delete.
    for (const platform of ['linux', 'darwin'] as const) {
      for (const name of ['backup-10:30.tar', 'what?.txt', 'trailing.', 'trailing ']) {
        expect(isSafeEntryName(name, platform).ok, `${platform}: ${name}`).toBe(true)
      }
    }
  })

  it('still refuses escapes outside Windows', () => {
    for (const name of ['..', '../..', 'a/b', '/etc/passwd']) {
      expect(isSafeEntryName(name, 'linux').ok, name).toBe(false)
    }
  })

  it('explains the refusal', () => {
    expect(isSafeEntryName('../x').reason).toMatch(/separator/)
    expect(isSafeEntryName('..').reason).toMatch(/relative/)
  })
})

describe('resolveInside', () => {
  it('resolves a plain name under the directory', () => {
    expect(resolveInside(dir, 'notes.txt')).toBe(join(dir, 'notes.txt'))
  })

  it('refuses to escape via the name', () => {
    for (const name of ['..', '../..', '../../etc/passwd', 'a/../../x']) {
      expect(resolveInside(dir, name), name).toBeNull()
    }
  })

  it('refuses an absolute name that would replace the directory', () => {
    expect(resolveInside(dir, '/etc/passwd')).toBeNull()
  })

  it('refuses when the directory itself is unusable', () => {
    expect(resolveInside('', 'a.txt')).toBeNull()
    expect(resolveInside(undefined, 'a.txt')).toBeNull()
    expect(resolveInside(dir, 'a.txt\u0000')).toBeNull()
  })

  it('does not treat a sibling with a shared prefix as inside', () => {
    // The naive `startsWith(base)` test would accept this.
    expect(resolveInside(join('/tmp', 'xssh-base'), '../xssh-base-evil/x')).toBeNull()
  })

  it('accepts a name that merely looks suspicious', () => {
    expect(resolveInside(dir, '..hidden')).toBe(join(dir, '..hidden'))
    expect(resolveInside(dir, 'a..b')).toBe(join(dir, 'a..b'))
  })

  it('works when the directory normalizes to a root', () => {
    // Regression: the containment check compared against `base + sep`, but
    // `normalize('C:\\')` keeps its trailing separator — so every name was
    // refused and nothing could be created in a drive root.
    const root = sep === '\\' ? 'C:\\' : '/'
    expect(resolveInside(root, 'a.txt')).toBe(join(root, 'a.txt'))
  })

  it('works when the caller passes a trailing separator', () => {
    // The renderer stores whatever `local:list` returned, but a path typed by
    // hand can keep its trailing slash.
    expect(resolveInside(dir + sep, 'a.txt')).toBe(join(dir, 'a.txt'))
    expect(resolveInside(dir + '/', 'a.txt')).toBe(join(dir, 'a.txt'))
  })

  it('still refuses to escape from a root', () => {
    const root = sep === '\\' ? 'C:\\' : '/'
    expect(resolveInside(root, '..')).toBeNull()
    expect(resolveInside(root, '../etc')).toBeNull()
  })
})

describe('resolveDir', () => {
  it('normalizes a directory path', () => {
    expect(resolveDir(join(dir, 'sub', '..'))).toBe(dir)
  })

  it('refuses empty and NUL-bearing paths', () => {
    expect(resolveDir('')).toBeNull()
    expect(resolveDir(undefined)).toBeNull()
    expect(resolveDir('/tmp/x\u0000y')).toBeNull()
  })

  it('still allows browsing anywhere the user points it', () => {
    // The local pane is a file manager: listing is not an escalation.
    expect(resolveDir('/tmp')).toBeTruthy()
  })
})