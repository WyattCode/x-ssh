/**
 * True when the zoom pill should force-release its hover state.
 *
 * The pill stays up while the pointer is on it (`hovering`), which is normally
 * cleared by `mouseleave`. If the window loses focus (Alt-Tab) or the document
 * is hidden while the pointer is still over the pill, that `mouseleave` never
 * arrives — the HUD would then stay open forever until the user re-enters and
 * leaves the pill. Both cases mean "the pointer is gone", so release.
 */
export function shouldReleaseZoomHover(visibilityState: string, blurred: boolean): boolean {
  return blurred || visibilityState === 'hidden'
}
