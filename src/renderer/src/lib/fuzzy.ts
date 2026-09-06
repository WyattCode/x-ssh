/**
 * Tiny subsequence fuzzy matcher. Returns a score (higher = better) or -1
 * when `query` is not a subsequence of `text`. Consecutive and word-boundary
 * matches are rewarded so "web1" ranks web-01 above a scattered match.
 */
export function fuzzyScore(query: string, text: string): number {
  if (!query) return 0
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let qi = 0
  let score = 0
  let streak = 0
  let prev = -1

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += 1
      if (prev === ti - 1) {
        streak += 1
        score += streak * 2
      } else {
        streak = 0
      }
      if (ti === 0 || /[\s\-_.@:/]/.test(t[ti - 1])) score += 3
      prev = ti
      qi++
    }
  }
  if (qi < q.length) return -1
  // Prefer shorter matches overall.
  return score - text.length * 0.05
}
