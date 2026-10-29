import { fuzzyScore } from './fuzzy'
import type { Host } from '../../../shared/types'

/** Best fuzzy score for a host against a palette query (trimmed by caller). -1 = no match. */
export function paletteHostScore(q: string, h: Host): number {
  if (!q) return 0
  const fields = [
    h.label,
    h.host,
    h.username,
    `${h.username}@${h.host}`,
    h.group ?? '',
    ...(h.tags ?? []),
    h.os?.pretty ?? ''
  ]
  let best = -1
  for (const f of fields) {
    if (!f) continue
    const s = fuzzyScore(q, f)
    if (s > best) best = s
  }
  return best
}
