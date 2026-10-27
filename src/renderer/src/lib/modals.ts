/**
 * Modal surfaces currently on screen.
 *
 * Global shortcuts must not fire while one is up: the keystroke lands on
 * whatever is behind the overlay. Ctrl+K over an open host editor opened the
 * palette *underneath* it (z-index 100 vs 110) and moved focus into a search
 * box the user could not see — typing went there and Enter could connect to a
 * host.
 *
 * The list below is the backdrop root of every dialog in the app. A new dialog
 * has to add its class here (or put `data-modal` on the root), or shortcuts
 * will fire behind it again.
 */
const MODAL_ROOTS = [
  '.overlay',
  '.layer',
  '.key-layer',
  '.pm-overlay',
  '.fd-overlay',
  '.lock-overlay',
  '.tm-overlay',
  '.rp-overlay',
  '.kp-overlay',
  '.fw-overlay',
  '.dlg-layer',
  '.sv-backdrop'
].join(',')

/** How many modal surfaces are up; the palette uses `1` to mean "only me". */
export function modalCount(): number {
  return document.querySelectorAll(MODAL_ROOTS).length
}

/** Where focus goes when the element that opened a confirm is gone by the time
 *  it closes (a menu item, a row the confirm itself deleted) or has been
 *  disabled: the topmost dialog root, else the SFTP drawer, which handles its
 *  own keys. Returns false when there was nothing to focus. */
export function focusFallbackSurface(): boolean {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>('[tabindex="-1"], .sftp[tabindex]')
  ).filter((el) => el.getClientRects().length > 0)
  const target = candidates[candidates.length - 1]
  if (!target) return false
  target.focus()
  return document.activeElement === target
}