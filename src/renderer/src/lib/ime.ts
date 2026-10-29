/**
 * Is this key event still owned by an input method?
 *
 * Chinese / Japanese / Korean input reaches the page as keydown events too:
 * while a candidate list is up, Enter selects the candidate rather than
 * submitting, and every key arrives with `keyCode === 229` (Chromium) or
 * `isComposing === true`. A handler that acts on Enter has to step aside for
 * both, otherwise typing 生产 into a name field creates the folder / saves the
 * host / runs the snippet under the *previous*, not-yet-replaced text.
 *
 * The arrow and Escape keys are the IME's too during composition, so check this
 * before dispatching any of them.
 *
 * One more rule that has bitten us: never call `preventDefault()` in a handler
 * bound with Vue's `.prevent` modifier on a key that the IME is using. `.prevent`
 * runs *before* the handler, so a guard inside the handler cannot undo it, and
 * cancelling a composing keydown keeps the candidate from ever being committed.
 * Bind the handler plainly and call `preventDefault()` yourself, after the guard.
 */
export function isImeKey(e: Event | KeyboardEvent | undefined | null): boolean {
  if (!e) return false
  const k = e as KeyboardEvent
  return k.isComposing === true || k.keyCode === 229
}