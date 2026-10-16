/**
 * Minimal glob matcher for the SFTP "select by pattern" batch action. Supports
 * `*`, `?`, `[abc]` / `[!abc]` character classes and `{a,b,c}` alternation —
 * enough for the common "select all *.log" style usage without pulling in a
 * library. Matching is case-sensitive and anchors the whole name.
 */

/** Recursively expands `{a,b}` alternations into a list of concrete patterns. */
function expandBraces(glob: string): string[] {
  const m = glob.match(/\{[^{}]*\}/)
  if (!m) return [glob]
  const alts = m[0].slice(1, -1).split(',')
  const prefix = glob.slice(0, m.index!)
  const suffix = glob.slice(m.index! + m[0].length)
  const out: string[] = []
  for (const alt of alts) {
    for (const expanded of expandBraces(prefix + alt + suffix)) out.push(expanded)
  }
  return out
}

/** Converts a brace-free glob to a regex source string. */
function simpleToRegExp(glob: string): string {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]
    if (ch === '*') {
      re += '[^/]*'
    } else if (ch === '?') {
      re += '[^/]'
    } else if (ch === '[') {
      let j = i + 1
      let neg = false
      if (glob[j] === '!' || glob[j] === '^') {
        neg = true
        j++
      }
      let cls = ''
      while (j < glob.length && glob[j] !== ']') {
        cls += glob[j]
        j++
      }
      // Unclosed class → treat the `[` literally.
      if (j >= glob.length) {
        re += '\\['
      } else {
        re += '[' + (neg ? '^' : '') + cls.replace(/\\/g, '\\\\') + ']'
        i = j
      }
    } else {
      // `]` and `\` included: Windows filenames are full of backslashes, and a
      // bare `\` would act as an escape instead of matching itself.
      re += ch.replace(/[\\\].+^${}()|]/g, '\\$&')
    }
  }
  return re
}

/** True when `value` matches the glob `pattern` (whole-string match). */
export function globMatch(pattern: string, value: string): boolean {
  const patterns = expandBraces(pattern)
  if (!patterns.length) return false
  const source = '^(?:' + patterns.map(simpleToRegExp).join('|') + ')$'
  try {
    return new RegExp(source).test(value)
  } catch {
    // An invalid pattern (e.g. a stray `]`) matches nothing rather than throws.
    return false
  }
}
