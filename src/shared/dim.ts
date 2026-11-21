// A colour as it looks under a black scrim of the given opacity. The Windows caption
// buttons are drawn by the OS above the page, so a dialog's dim layer cannot reach them;
// main paints them with this colour while a dialog is up.

/** `hex` (#rrggbb) darkened by a black layer of opacity `scrim` (0…1). Anything that is
 *  not a six-digit hex is returned as it was. */
export function dimHex(hex: string, scrim: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const k = 1 - Math.min(1, Math.max(0, scrim))
  const n = parseInt(m[1], 16)
  const ch = (shift: number): string => Math.round(((n >> shift) & 255) * k).toString(16).padStart(2, '0')
  return `#${ch(16)}${ch(8)}${ch(0)}`
}
