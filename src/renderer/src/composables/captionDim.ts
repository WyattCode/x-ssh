// While a dialog's dim layer is on screen, tell main how dark the window is under it, so the
// Windows caption buttons (drawn by the OS above the page, out of the scrim's reach) can be
// painted that dark too.

/** The backdrop root of every dialog in the app (see lib/modals.ts, plus the centered dialog shell). */
const SCRIM_ROOTS = [
  '.overlay', '.layer', '.modal-layer', '.key-layer', '.pm-overlay', '.fd-overlay',
  '.tm-overlay', '.rp-overlay', '.kp-overlay', '.fw-overlay', '.dlg-layer', '.sv-backdrop'
].join(',')

/** Alpha of a computed `rgb()` / `rgba()` colour (1 when it has none, 0 when it is not a colour). */
export function alphaOf(color: string): number {
  const m = /^rgba?\(([^)]+)\)$/.exec(color.trim())
  if (!m) return 0
  const parts = m[1].split(/[\s,/]+/).filter(Boolean)
  return parts.length >= 4 ? Math.min(1, Math.max(0, Number(parts[3]) || 0)) : 1
}

/** How dark the dim layers on screen make the window: stacked layers compose (1 − Π(1 − a)). The
 *  lock screen is not a dim layer (it covers the window with its own colour), so it is left out. */
export function currentDim(): number {
  let clear = 1
  for (const el of document.querySelectorAll(SCRIM_ROOTS)) {
    const a = alphaOf(getComputedStyle(el).backgroundColor)
    // A transparent root (a positioning wrapper, a popup anchor) dims nothing.
    if (a > 0 && a < 1) clear *= 1 - a
  }
  return Math.round((1 - clear) * 100) / 100
}

/** Starts watching; returns the stop function. No-op where the preload has no caption hook. */
export function watchCaptionDim(root: HTMLElement): () => void {
  const send = window.api?.setCaptionDim
  if (typeof send !== 'function') return () => undefined
  let last = 0
  let frame = 0
  const sync = (): void => {
    frame = 0
    const now = currentDim()
    if (now === last) return
    last = now
    send(now)
  }
  const obs = new MutationObserver(() => {
    if (!frame) frame = requestAnimationFrame(sync)
  })
  // Dialogs are mounted and unmounted (v-if); that is all this needs to see.
  obs.observe(root, { childList: true, subtree: true })
  sync()
  return () => {
    obs.disconnect()
    if (frame) cancelAnimationFrame(frame)
    if (last) send(0)
  }
}
