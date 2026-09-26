/**
 * Unix permission-bit helpers for the chmod dialog.
 *
 * The dialog shows the same value three ways — checkboxes, an octal field and a
 * symbolic `rwxr-xr-x` preview — and all three have to agree. Keeping the
 * conversions here (rather than inline in the component) means the agreement is
 * testable, which matters because a mis-shown mode is applied to real files.
 */

/** The permission bits the dialog manages (setuid/setgid/sticky included). */
export const MODE_MASK = 0o7777

/** The 12 bits as three groups, for the checkbox grid. */
export interface BitGroup {
  /** i18n key for the group heading. */
  labelKey: string
  /** i18n key for each permission, paired with its mask. */
  bits: { labelKey: string; mask: number }[]
}

export const BIT_GROUPS: BitGroup[] = [
  {
    labelKey: 'sfp.permOwner',
    bits: [
      { labelKey: 'sfp.read', mask: 0o400 },
      { labelKey: 'sfp.write', mask: 0o200 },
      { labelKey: 'sfp.execute', mask: 0o100 }
    ]
  },
  {
    labelKey: 'sfp.permGroup',
    bits: [
      { labelKey: 'sfp.read', mask: 0o040 },
      { labelKey: 'sfp.write', mask: 0o020 },
      { labelKey: 'sfp.execute', mask: 0o010 }
    ]
  },
  {
    labelKey: 'sfp.permOther',
    bits: [
      { labelKey: 'sfp.read', mask: 0o004 },
      { labelKey: 'sfp.write', mask: 0o002 },
      { labelKey: 'sfp.execute', mask: 0o001 }
    ]
  }
]

/** Clamp anything to the bits this dialog manages. */
export function clampMode(mode: number): number {
  return mode & MODE_MASK
}

/** Octal text for the field, always at least three digits (`755`, `644`). */
export function toOctal(mode: number): string {
  return clampMode(mode).toString(8).padStart(3, '0')
}

/**
 * Parse the octal field's text. Non-octal characters are dropped, which is what
 * lets the field reject an `8` as the user types it. Empty text means no mode
 * yet — the caller shows a validation message rather than defaulting to `000`.
 */
export function parseOctal(text: string): number | null {
  const cleaned = sanitizeOctalText(text)
  if (!cleaned) return null
  return clampMode(parseInt(cleaned, 8))
}

/** Sanitize field text as the user types, so a rejected character disappears. */
export function sanitizeOctalText(text: string): string {
  return text.replace(/[^0-7]/g, '').slice(0, 4)
}

/** The `rwxr-xr-x` preview. Setuid/setgid/sticky are not shown — the checkboxes
 *  and the octal field are the source of truth for those. */
export function toSymbolic(mode: number): string {
  const m = clampMode(mode)
  const tri = (bits: number): string =>
    (bits & 4 ? 'r' : '-') + (bits & 2 ? 'w' : '-') + (bits & 1 ? 'x' : '-')
  return tri((m >> 6) & 7) + tri((m >> 3) & 7) + tri(m & 7)
}