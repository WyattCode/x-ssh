// Where an icon's box and stroke land on the screen's own pixels (see components/Icon.vue).
//
// The glyphs are drawn on a 24-unit grid and centred on its middle line (x = 12, y = 12). That line sits
// on a pixel EDGE when the box is an even number of device pixels, and in the MIDDLE of a pixel when it is
// odd. A stroke of even width needs the first, an odd one the second; otherwise the line is smeared over
// an extra pixel. So the box takes the stroke's parity.

export interface IconSnap {
  /** Box and stroke in whole device pixels. */
  boxDev: number
  strokeDev: number
  /** The box in CSS px (a whole number of device pixels). */
  boxCss: number
  /** The stroke in the 24-unit grid, for the svg's stroke-width. */
  strokeUnits: number
}

/** `wantedCss`: the box asked for, CSS px. `strokeCss`: the stroke asked for, CSS px. `dpr`: device pixels per CSS px. */
export function snapIcon(wantedCss: number, strokeCss: number, dpr: number): IconSnap {
  const k = dpr > 0 && Number.isFinite(dpr) ? dpr : 1
  const strokeDev = Math.max(1, Math.round(strokeCss * k))
  const want = wantedCss * k
  const n = Math.max(2, Math.round(want))
  const boxDev = n % 2 === strokeDev % 2 ? n : want >= n ? n + 1 : n - 1
  return { boxDev, strokeDev, boxCss: boxDev / k, strokeUnits: (strokeDev * 24) / boxDev }
}
