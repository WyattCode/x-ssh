/**
 * Tiny subsequence fuzzy matcher. `fuzzyScore` returns a score (higher =
 * better) or -1 when `query` is not a subsequence of `text`; `fuzzyMatch`
 * returns the matched indices for highlighting. Consecutive and word-boundary
 * matches are rewarded so "web1" ranks web-01 above a scattered match.
 */

/** Indices (in `text`) of the chars matched by `query`, in order. Empty when
 *  there is no query or no subsequence match. */
export function fuzzyMatch(query: string, text: string): number[] {
  if (!query) return []
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  const indices: number[] = []
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      indices.push(ti)
      qi++
    }
  }
  return qi < q.length ? [] : indices
}

/** Scores how well `query` matches `text`, or -1 for no subsequence match. */
export function fuzzyScore(query: string, text: string): number {
  if (!query) return 0
  const indices = fuzzyMatch(query, text)
  if (indices.length !== query.length) return -1
  const t = text.toLowerCase()
  let score = 0
  let streak = 0
  let prev = -1
  for (const ti of indices) {
    score += 1
    if (prev === ti - 1) {
      streak += 1
      score += streak * 2
    } else {
      streak = 0
    }
    if (ti === 0 || /[\s\-_.@:/]/.test(t[ti - 1])) score += 3
    prev = ti
  }
  // Prefer shorter matches overall.
  return score - text.length * 0.05
}
