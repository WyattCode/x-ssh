/**
 * Renders a shortcut spec into chips for the Shortcuts panel. A spec like
 * "Mod+1 … Mod+8" or "Ctrl+Shift+C / Ctrl+Shift+V" is split on the `…` / `/`
 * separators (surrounded by whitespace) into chord groups. Pure and dependency
 * free so it can be unit-tested; the caller applies i18n labels and the
 * platform modifier symbol.
 */

export type ShortcutChip = { chord: string[] } | { sep: 'or' | 'ellipsis' }

/** Splits a spec into chord groups and the separators between them. */
export function splitShortcutChips(keys: string): ShortcutChip[] {
  return keys
    .split(/\s+([/…])\s+/)
    .filter((piece) => piece !== '')
    .map((piece): ShortcutChip =>
      piece === '/'
        ? { sep: 'or' }
        : piece === '…'
          ? { sep: 'ellipsis' }
          : { chord: piece.split('+') }
    )
}
