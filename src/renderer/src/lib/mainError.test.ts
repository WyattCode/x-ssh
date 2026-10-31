import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MAIN_ERROR_KEYS, isTranslatedCode, mainErrorText } from './mainError'

/**
 * `mainError.ts` looks its dictionary keys up dynamically, so `lint:i18n`
 * cannot see them and a typo would silently render the key name in the UI.
 *
 * The dictionaries are read from source rather than imported: `i18n.ts` reads
 * `window.api` at module scope, which does not exist under the test runner.
 * Parsing also checks each language separately, which an import merged through
 * `translate()` (zh-TW → zh → en fallback) would hide.
 */
function keysOf(lang: 'zh' | 'zhTW' | 'en'): Set<string> {
  const src = readFileSync(resolve(__dirname, 'i18n.ts'), 'utf8')
  const constName = lang === 'zhTW' ? 'zhTW' : lang
  const start = src.indexOf(`const ${constName}: Dict = {`)
  expect(start, `${constName} dictionary not found`).toBeGreaterThan(-1)
  const end = src.indexOf('\n}', start)
  const block = src.slice(start, end)
  // Keys may be quoted either way, and the file sometimes packs two entries on
  // one line (`'sfp.discard': '…',  'sfp.editPath': '…',`). Match globally
  // rather than per-line so a shared line is not counted once.
  return new Set(
    [...block.matchAll(/(?:^|[,{\s])['"]([^'"\n]+)['"]\s*:/g)].map((m) => m[1])
  )
}

const t = (key: string): string => `[${key}]`

describe('mainError table', () => {
  const dicts = {
    zh: keysOf('zh'),
    'zh-TW': keysOf('zhTW'),
    en: keysOf('en')
  }

  it('parsed all three dictionaries', () => {
    // Guards the parser itself: a rename of `const zh: Dict` would otherwise
    // make the coverage test below pass on an empty set.
    expect(dicts.zh.size).toBeGreaterThan(500)
    expect(dicts.en.size).toBe(dicts.zh.size)
    expect(dicts['zh-TW'].size).toBe(dicts.zh.size)
  })

  it('every code maps to a key present in all three dictionaries', () => {
    for (const [code, key] of Object.entries(MAIN_ERROR_KEYS)) {
      for (const [lang, keys] of Object.entries(dicts)) {
        expect(keys.has(key), `${code} → ${key} missing in ${lang}`).toBe(true)
      }
    }
  })

  it('does not leave unused rows behind', () => {
    // A row nobody references means a code that was renamed in main.
    const used = new Set(Object.values(MAIN_ERROR_KEYS))
    expect(used.size).toBe(Object.keys(MAIN_ERROR_KEYS).length)
  })

  it('translates known codes through the dictionary key', () => {
    expect(mainErrorText('conn-reset', t)).toBe('[err.connReset]')
    expect(mainErrorText('fs-permission', t)).toBe('[err.fsPermission]')
  })

  it('unwraps raw-error: to the original text', () => {
    // Node/ssh2 wording is specific; better than a generic "operation failed".
    expect(mainErrorText('raw-error:ENOSPC: no space left on device', t)).toBe(
      'ENOSPC: no space left on device'
    )
  })

  it('never leaves a raw-error: wrapper or an empty string in the UI', () => {
    expect(mainErrorText('raw-error:   ', t)).toBe('[err.unknown]')
    expect(mainErrorText('raw-error:', t)).toBe('[err.unknown]')
  })

  it('passes an unknown code through so the gap stays visible', () => {
    expect(mainErrorText('some-new-code', t)).toBe('some-new-code')
    expect(isTranslatedCode('some-new-code')).toBe(false)
  })

  it('returns undefined for nothing at all, letting each caller pick its own fallback', () => {
    expect(mainErrorText(undefined, t)).toBeUndefined()
    expect(mainErrorText('', t)).toBeUndefined()
  })
})