// App zoom. Chromium's zoom is a "level" (factor = 1.2 ^ level) and that is what the
// settings file keeps, but people think in percent, and every step the app offers
// is a whole multiple of 10 %: 50, 60 … 120 … 250. All conversions live here so the
// preload (first paint), the renderer (shortcuts, wheel, the pill) and the main
// process (caption-button height) agree on the same numbers.

export const ZOOM_MIN_PCT = 50
export const ZOOM_MAX_PCT = 250
export const ZOOM_STEP_PCT = 10
/** What a fresh install opens at and what "reset" returns to. */
export const ZOOM_DEFAULT_PCT = 120

const BASE = 1.2

export function percentToLevel(pct: number): number {
  return Math.log(pct / 100) / Math.log(BASE)
}
export function levelToFactor(level: number): number {
  return Math.pow(BASE, level)
}
export function levelToPercent(level: number): number {
  return Math.round(levelToFactor(level) * 100)
}

/** The nearest allowed percentage: a whole multiple of 10, inside 50…250.
 *  Anything that is not a number falls back to the default. */
export function snapPercent(pct: number): number {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return ZOOM_DEFAULT_PCT
  const stepped = Math.round(pct / ZOOM_STEP_PCT) * ZOOM_STEP_PCT
  return Math.min(ZOOM_MAX_PCT, Math.max(ZOOM_MIN_PCT, stepped))
}

/** A stored or live level, moved onto the ladder (older versions saved levels such
 *  as 1.5 = 131 %). Returns the level to apply. */
export function snapLevel(level: number): number {
  if (typeof level !== 'number' || !Number.isFinite(level)) return percentToLevel(ZOOM_DEFAULT_PCT)
  return percentToLevel(snapPercent(levelToPercent(level)))
}

/** One step up (+1) or down (-1) from the current percentage. */
export function stepPercent(pct: number, dir: 1 | -1): number {
  return snapPercent(snapPercent(pct) + dir * ZOOM_STEP_PCT)
}
