/**
 * Where to park the macOS traffic lights at a given page-zoom factor.
 *
 * The lights are drawn by the OS at a constant size, at a constant spot; page
 * zoom (webFrame.setZoomLevel, 50…250 %) carries the top band's centre line
 * away from them. Measured on screen (macOS, Electron 33.4.11, titleBarStyle
 * 'hiddenInset'): the close button's left edge at x = 13.0 pt, the three
 * buttons' centres at y = 18.8 pt (centres at x ≈ 18.8 / 38.8 / 58.8 pt),
 * diameter 11–12 pt. The band is --band-top = 40 CSS px, so its centre sits at
 * 20 × factor pt: 1.2 pt below the lights' line at 100 %, 5.2 pt below at the
 * 120 % default, 21.2 pt below at 200 %.
 *
 * BrowserWindow.setWindowButtonPosition takes the absolute inset from the
 * window's top-left (same semantics as the trafficLightPosition constructor
 * option — NOT an offset from the default position), so we keep x at the
 * measured default and shift y by how far the band's centre moved.
 *
 * Every number here is a pixel measurement — re-measure when macOS or Electron
 * changes. `BrowserWindow.getWindowButtonPosition()` exists and can be used to
 * confirm a push took, but a full-screen transition can hand the buttons back
 * to the OS default, so the recovery is to push this function's answer again
 * (the old setTrafficLightPosition / getTrafficLightPosition pair does not
 * exist in Electron 33 and must not be called).
 */

/** Measured: the close button's left edge, pt from the window's left edge. */
const MAC_LIGHT_DEFAULT_LEFT_PT = 13.0
/** Measured: the three buttons' centres' y, pt from the window's top edge. */
const MAC_LIGHT_DEFAULT_CENTRE_Y_PT = 18.8
/** Measured: a button's radius (diameter 11–12 pt), pt. */
const MAC_LIGHT_RADIUS_PT = 5.75
/** Derived: the top inset of the buttons' box at the default position = centre − radius. */
const MAC_LIGHT_DEFAULT_TOP_PT = MAC_LIGHT_DEFAULT_CENTRE_Y_PT - MAC_LIGHT_RADIUS_PT // 13.05
/** The top band's centre at 100 %: half of --band-top (40 CSS px, styles/global.css). */
const BAND_CENTRE_CSS_PT = 20

/**
 * The absolute inset to hand setWindowButtonPosition for this zoom factor,
 * or null to leave the lights to the OS default (bad factor, or the band
 * already close enough to the lights' line that pinning the measured
 * constants would only bake in measurement noise).
 */
export function macLightPosition(factor: number): { x: number; y: number } | null {
  if (!Number.isFinite(factor) || factor <= 0) return null
  // At 100 % the formula's answer is the gap between two measured constants
  // (20 − 18.8 = 1.2 pt), not a misalignment we can trust to exist on another
  // macOS build. Hand the lights back to the OS instead of pinning them.
  if (factor === 1) return null
  const bandCentrePt = BAND_CENTRE_CSS_PT * factor
  // Defensive, not a step this app reaches: on the 10 % ladder only factor ≈ 0.94
  // would land here (100 % is handed back above), and any ladder that does should
  // treat a sub-pixel hit as "leave it to the OS" rather than pin measurement noise.
  if (Math.abs(bandCentrePt - MAC_LIGHT_DEFAULT_CENTRE_Y_PT) < 0.05) return null
  return { x: MAC_LIGHT_DEFAULT_LEFT_PT, y: MAC_LIGHT_DEFAULT_TOP_PT + (bandCentrePt - MAC_LIGHT_DEFAULT_CENTRE_Y_PT) }
}
