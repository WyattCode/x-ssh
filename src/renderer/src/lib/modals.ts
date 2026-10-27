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