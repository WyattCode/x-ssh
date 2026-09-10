/**
 * Minimal line-based unified diff (LCS). Returns a list of hunks, each a sequence
 * of lines tagged 'same' | 'add' | 'del'. Good enough for a quick compare view
 * without pulling in a full diff library.
 */

export type DiffLine = { kind: 'same' | 'add' | 'del'; text: string; a?: number; b?: number }

export interface DiffResult {
  lines: DiffLine[]
  adds: number
  dels: number
  identical: boolean
}

/** Split into lines preserving an EOF-newline sentinel for clean diffing. */
function split(s: string): string[] {
  return s.replace(/\r\n/g, '\n').split('\n')
}

/** LCS over the lines of a and b. */
function lcs(a: string[], b: string[]): number[][] {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  return dp
}

export function diffLines(aText: string, bText: string): DiffResult {
  const a = split(aText)
  const b = split(bText)
  // Trailing empty element from a final newline is an artifact of split(); drop
  // both so a "file ends with newline" and "doesn't" aren't treated as a diff.
  if (a.length && a[a.length - 1] === '') a.pop()
  if (b.length && b[b.length - 1] === '') b.pop()
  const dp = lcs(a, b)
  const lines: DiffLine[] = []
  let i = 0
  let j = 0
  let adds = 0
  let dels = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ kind: 'same', text: a[i], a: i + 1, b: j + 1 })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push({ kind: 'del', text: a[i++], a: i })
      dels++
    } else {
      lines.push({ kind: 'add', text: b[j++], b: j })
      adds++
    }
  }
  while (i < a.length) {
    lines.push({ kind: 'del', text: a[i++], a: i })
    dels++
  }
  while (j < b.length) {
    lines.push({ kind: 'add', text: b[j++], b: j })
    adds++
  }
  return { lines, adds, dels, identical: adds === 0 && dels === 0 }
}
