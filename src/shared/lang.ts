/**
 * Interface languages and the "follow system" mapping, shared by main (tray
 * menu) and the renderer (i18n) so both pick the same language.
 *
 * `'zh'` is Simplified Chinese and stays that way so settings saved before
 * Traditional Chinese existed keep meaning the same thing.
 */
export type UiLang = 'zh' | 'zh-TW' | 'en'

/** What the `lang` setting may hold. `'system'` (or no value) follows the OS. */
export type LangPref = UiLang | 'system'

export const UI_LANGS: readonly UiLang[] = ['zh', 'zh-TW', 'en']

/** Normalizes a stored `lang` value; anything unknown or missing means `'system'`. */
export function parseLangPref(v: unknown): LangPref {
  return v === 'zh' || v === 'zh-TW' || v === 'en' || v === 'system' ? v : 'system'
}

/**
 * Maps one BCP 47 locale tag to an interface language:
 * Traditional Chinese (zh-Hant*, zh-TW, zh-HK, zh-MO) → 'zh-TW',
 * any other Chinese → 'zh', everything else → 'en'.
 * An explicit script subtag wins over the region (zh-Hans-HK → 'zh').
 */
export function langFromLocale(locale: string | undefined | null): UiLang {
  const parts = (locale ?? '').trim().replace(/_/g, '-').toLowerCase().split('-')
  if (parts[0] !== 'zh') return 'en'
  const rest = parts.slice(1)
  if (rest.includes('hans')) return 'zh'
  if (rest.includes('hant')) return 'zh-TW'
  if (rest.some((p) => p === 'tw' || p === 'hk' || p === 'mo')) return 'zh-TW'
  return 'zh'
}

/** The language for the user's most preferred system locale (first non-empty entry). */
export function langFromLocales(locales: readonly (string | undefined | null)[]): UiLang {
  const first = locales.find((l) => typeof l === 'string' && l.trim() !== '')
  return langFromLocale(first)
}

/** The language actually shown for a stored preference. */
export function resolveLang(pref: unknown, systemLocales: readonly (string | undefined | null)[]): UiLang {
  const p = parseLangPref(pref)
  return p === 'system' ? langFromLocales(systemLocales) : p
}
