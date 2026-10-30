/**
 * Pause bookkeeping for the transfer panel.
 *
 * A plain `Set` is not reactive in Vue 3: mutating it in place leaves the
 * template showing the old glyph until some unrelated reactive update (a
 * progress tick) happens to re-render the row — which is exactly how the
 * per-row pause/resume icon ended up stuck on the wrong one. Every helper here
 * returns a *new* Set, so the caller can assign it to a `ref` and get a render.
 */

/** Add or remove [id]; returns a new Set and never mutates [paused]. */
export function toggleId(paused: Set<string>, id: string, pause: boolean): Set<string> {
  const next = new Set(paused)
  if (pause) next.add(id)
  else next.delete(id)
  return next
}

/**
 * True only when there is at least one active row and every one of them is
 * paused. An empty list is *not* "all paused" — the header button is hidden
 * then, and a stale `true` would make the next job look paused.
 */
export function allPausedFlag(activeIds: readonly string[], paused: Set<string>): boolean {
  if (activeIds.length === 0) return false
  return activeIds.every((id) => paused.has(id))
}

/**
 * Drop ids that are no longer active (finished, cancelled, failed). Returns
 * [paused] itself when nothing changed, so callers can skip the assignment —
 * and the extra re-render that would come with it.
 */
export function prunePaused(paused: Set<string>, activeIds: readonly string[]): Set<string> {
  const live = new Set(activeIds)
  let stale = false
  for (const id of paused) {
    if (!live.has(id)) {
      stale = true
      break
    }
  }
  if (!stale) return paused
  const next = new Set<string>()
  for (const id of paused) if (live.has(id)) next.add(id)
  return next
}
