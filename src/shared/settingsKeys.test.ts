import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  isRendererSettableKey,
  RENDERER_SETTABLE_KEYS,
  MAIN_ONLY_KEYS
} from './settingsKeys'

/**
 * Every settings key the renderer writes, however it writes it.
 *
 * Three shapes reach `settings:set`: `saveSetting('k', v)` (the store, which
 * logs refusals), `window.api.settings.set('k', v)` (direct, silent), and
 * `settings.set('k', v)`. All three must be covered — a new direct call site
 * that isn't allowlisted would fail silently at runtime.
 */
function rendererWrittenKeys(): Set<string> {
  const used = new Set<string>()
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(ts|vue)$/.test(e.name)) {
        const s = readFileSync(p, 'utf8')
        for (const m of s.matchAll(/saveSetting\(\s*'([^']+)'/g)) used.add(m[1])
        for (const m of s.matchAll(/(?:window\.api\.)?settings\.set\(\s*'([^']+)'/g)) used.add(m[1])
      }
    }
  }
  walk('src/renderer')
  return used
}

describe('renderer-settable settings keys', () => {
  it('accepts the keys the renderer actually writes', () => {
    // A sample of the real call sites, covering each section of SettingsDialog.
    for (const key of [
      'lang',
      'keybindings',
      'transferConcurrency',
      'sftpWidth',
      'snapshots',
      'autoBackupDir',
      'minimizeToTray'
    ]) {
      expect(isRendererSettableKey(key), key).toBe(true)
    }
  })

  it('refuses the master-lock record', () => {
    // The whole point: overwriting this from the renderer would silently drop
    // the app lock, and the in-memory MasterLock would not notice until restart.
    expect(isRendererSettableKey('masterLock')).toBe(false)
  })

  it('refuses the other keys main owns', () => {
    for (const key of MAIN_ONLY_KEYS) {
      expect(isRendererSettableKey(key), key).toBe(false)
    }
  })

  it('refuses unknown keys rather than defaulting to allow', () => {
    expect(isRendererSettableKey('somethingNew')).toBe(false)
    expect(isRendererSettableKey('')).toBe(false)
  })

  it('refuses non-string keys', () => {
    expect(isRendererSettableKey(undefined)).toBe(false)
    expect(isRendererSettableKey(42)).toBe(false)
    // Guards against a key assembled from user input reaching the store.
    expect(isRendererSettableKey({ toString: () => 'lang' })).toBe(false)
  })

  it('never lists a key in both sets', () => {
    for (const key of MAIN_ONLY_KEYS) {
      expect(RENDERER_SETTABLE_KEYS.has(key), key).toBe(false)
    }
  })

  it('covers every key the renderer actually writes', () => {
    // The guard that makes the allowlist safe to have: a new preference that
    // forgets to register here would otherwise be silently refused at runtime.
    const used = rendererWrittenKeys()
    const blocked = [...used].filter((k) => !RENDERER_SETTABLE_KEYS.has(k)).sort()
    expect(blocked, 'these keys would be refused by settings:set').toEqual([])
    expect(used.size, 'the scan found no call sites — did the pattern change?').toBeGreaterThan(20)
  })

  it('does not list keys nobody writes any more', () => {
    const used = rendererWrittenKeys()
    const stale = [...RENDERER_SETTABLE_KEYS].filter((k) => !used.has(k)).sort()
    expect(stale, 'remove these from the allowlist').toEqual([])
  })
})