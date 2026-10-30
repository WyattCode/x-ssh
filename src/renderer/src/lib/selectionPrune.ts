/** Drop names that are no longer in `shown`. Returns the same Set reference if unchanged. */
export function pruneSelection(selected: Set<string>, shown: Iterable<string>): Set<string> {
  if (!selected.size) return selected
  const alive = shown instanceof Set ? shown : new Set(shown)
  let changed = false
  const next = new Set<string>()
  for (const n of selected) {
    if (alive.has(n)) next.add(n)
    else changed = true
  }
  return changed ? next : selected
}
