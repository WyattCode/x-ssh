import { describe, it, expect } from 'vitest'
import { langFromLocale, langFromLocales, parseLangPref, resolveLang } from './lang'

describe('langFromLocale', () => {
  it.each([
    ['zh-TW', 'zh-TW'],
    ['zh-HK', 'zh-TW'],
    ['zh-MO', 'zh-TW'],
    ['zh-Hant', 'zh-TW'],
    ['zh-Hant-TW', 'zh-TW'],
    ['zh-Hant-HK', 'zh-TW'],
    ['zh_TW', 'zh-TW'],
    ['zh', 'zh'],
    ['zh-CN', 'zh'],
    ['zh-SG', 'zh'],
    ['zh-Hans', 'zh'],
    ['zh-Hans-CN', 'zh'],
    ['zh-Hans-HK', 'zh'],
    ['en-US', 'en'],
    ['ja-JP', 'en'],
    ['', 'en'],
    [undefined, 'en']
  ])('%s → %s', (locale, want) => {
    expect(langFromLocale(locale)).toBe(want)
  })
})

describe('langFromLocales', () => {
  it('uses the first non-empty locale', () => {
    expect(langFromLocales(['', 'zh-HK', 'en-US'])).toBe('zh-TW')
    expect(langFromLocales(['en-US', 'zh-TW'])).toBe('en')
    expect(langFromLocales([])).toBe('en')
  })
})

describe('parseLangPref / resolveLang', () => {
  it('keeps explicit choices, including the pre-existing zh / en values', () => {
    expect(resolveLang('zh', ['en-US'])).toBe('zh')
    expect(resolveLang('en', ['zh-TW'])).toBe('en')
    expect(resolveLang('zh-TW', ['zh-CN'])).toBe('zh-TW')
  })
  it('follows the system when unset, "system" or unknown', () => {
    expect(parseLangPref(undefined)).toBe('system')
    expect(parseLangPref('fr')).toBe('system')
    expect(resolveLang(undefined, ['zh-TW'])).toBe('zh-TW')
    expect(resolveLang('system', ['zh-CN'])).toBe('zh')
    expect(resolveLang(null, ['de-DE'])).toBe('en')
  })
})
