/**
 * Contrast math shared by the UI (the accent picker warns and can fix a color
 * that would be unreadable as text) and, in spirit, by scripts/check-contrast.mjs
 * which applies the same rules to the static theme tokens.
 *
 * The two copies exist because the node script reads CSS *source text* before
 * anything is in the DOM while this runs in the renderer against a chosen hex.
 * Both implement WCAG 2.1 relative luminance and the (L1+0.05)/(L2+0.05) ratio.
 */

const srgb = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

/** #rgb or #rrggbb -> [r,g,b] 0..255. Anything unparsable reads as black. */
export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (!/^[0-9a-f]{6}$/i.test(h)) return [0, 0, 0]
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => srgb(v / 255))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two hex colors: 1..21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

/** AA for normal text (< 18pt, or < 14pt bold): 4.5:1. */
export const AA_NORMAL = 4.5

export function meetsAA(fg: string, bg: string, want = AA_NORMAL): boolean {
  return contrastRatio(fg, bg) >= want
}

function toHex(rgb: [number, number, number]): string {
  return (
    '#' +
    rgb
      .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
      .join('')
  )
}

/**
 * The closest version of `hex` (moving it straight toward black or white, so the
 * hue and saturation the user picked survive) that clears `want` against `bg`.
 * Returns `hex` unchanged when it already passes.
 *
 * Used by the accent picker: the color is the user's choice, so the fix nudges
 * it as little as possible rather than swapping in a different palette entry.
 */
export function nudgeToContrast(hex: string, bg: string, want = AA_NORMAL): string {
  if (meetsAA(hex, bg, want)) return hex
  // Toward black on a light background, toward white on a dark one.
  const goal: [number, number, number] = luminance(bg) > 0.5 ? [0, 0, 0] : [255, 255, 255]
  const base = hexToRgb(hex)
  const at = (t: number): string =>
    toHex([0, 1, 2].map((i) => base[i] + (goal[i] - base[i]) * t) as [number, number, number])
  let lo = 0
  let hi = 1
  for (let i = 0; i < 24 && hi - lo > 1 / 255; i++) {
    const mid = (lo + hi) / 2
    if (meetsAA(at(mid), bg, want)) hi = mid
    else lo = mid
  }
  return at(hi)
}

/** A ratio formatted for display: "2.4:1". */
export function formatRatio(r: number): string {
  return `${r.toFixed(1)}:1`
}
