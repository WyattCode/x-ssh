/**
 * Where to park the macOS traffic lights at a given page-zoom factor.
 *
 * The lights are drawn by the OS at a constant size, at a constant spot; page
 * zoom (webFrame.setZoomLevel, 50…250 %) carries the top band away from them.
 * Every zoom step — 100 % included — gets an explicit push that puts the
 * lights' centre on the band's visible centre line, so the lights do not jump
 * between steps.
 *
 * All offsets below are per-pixel measurements taken on a 3840×2160 display at
 * 2 px/pt (macOS, Electron 33.4.11, titleBarStyle 'hiddenInset'), verified at
 * 50 % / 100 % / 120 % / 200 %:
 * - setWindowButtonPosition's y is the TOP EDGE of the buttons' box (≈ 14.5 pt
 *   tall), and the lights' centre sits MAC_LIGHT_CENTRE_OVER_TOP_PT below that
 *   pushed y (pushed 4.25 / 18.25 / 34.25 measured centres 11.5 / 25.5 / 41.5
 *   pt from the window's top).
 * - The band is --band-top = 40 CSS px; its visible centre line (the bottom
 *   divider hairline excluded) runs at BAND_CENTRE_CSS_PT × factor −
 *   BAND_VISIBLE_CENTRE_OFFSET_PT pt (measured 9.5 / 19.25 / 23.25 / 38.75 pt
 *   at 0.5 / 1.0 / 1.2 / 2.0).
 * Setting the two equal gives pushed y = 20 × factor − 8.0:
 * 0.5 → 2.0, 1.0 → 12.0, 1.2 → 16.0, 2.0 → 32.0, 2.5 → 42.0 pt.
 *
 * x never moves: the lights' horizontal geometry (centres 20 pt apart, 11.75 pt
 * diameter, green button's right edge 64.0 pt from the window's left) measured
 * identical at every zoom step, and the renderer's max(78px, 70px / --zf)
 * padding (styles/global.css) keeps the first band control 12.0 pt clear of
 * the lights even at 50 %.
 *
 * BrowserWindow.setWindowButtonPosition takes the absolute inset from the
 * window's top-left (same semantics as the trafficLightPosition constructor
 * option — NOT an offset from the default position).
 *
 * Every number here is a pixel measurement from one screen — re-measure when
 * macOS or Electron changes. `BrowserWindow.getWindowButtonPosition()` exists
 * and can be used to confirm a push took, but a full-screen transition can
 * hand the buttons back to the OS default, so the recovery is to push this
 * function's answer again (the old setTrafficLightPosition /
 * getTrafficLightPosition pair does not exist in Electron 33 and must not be
 * called).
 */

/** Measured: the close button's left edge, pt from the window's left edge. */
const MAC_LIGHT_DEFAULT_LEFT_PT = 13.0
/** Measured: how far below the pushed y (the buttons' box top edge) their centre sits. */
const MAC_LIGHT_CENTRE_OVER_TOP_PT = 7.25
/** Measured: the band's visible centre line sits this far above 20 × factor (bottom divider excluded). */
const BAND_VISIBLE_CENTRE_OFFSET_PT = 0.75
/** The top band's nominal centre at 100 %: half of --band-top (40 CSS px, styles/global.css). */
const BAND_CENTRE_CSS_PT = 20

/**
 * The absolute inset to hand setWindowButtonPosition for this zoom factor,
 * or null only for a bad factor (the caller then leaves the lights to the OS).
 * 100 % is deliberately NOT special any more: it gets the same computed push
 * as every other step — handing it back to the OS default put the lights'
 * centre at 13.5 pt against this step's 19.25 pt line, a ~6 pt jump around
 * 100 % on the 10 % ladder.
 */
export function macLightPosition(factor: number): { x: number; y: number } | null {
  if (!Number.isFinite(factor) || factor <= 0) return null
  const bandCentrePt = BAND_CENTRE_CSS_PT * factor
  return {
    x: MAC_LIGHT_DEFAULT_LEFT_PT,
    y: bandCentrePt - BAND_VISIBLE_CENTRE_OFFSET_PT - MAC_LIGHT_CENTRE_OVER_TOP_PT,
  }
}
