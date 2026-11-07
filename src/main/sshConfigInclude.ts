import { readFile, readdir } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

/**
 * Expands `Include` directives in an ssh config before parsing.
 *
 * `Include config.d/*` is the layout OpenSSH itself recommends, and it was
 * silently ignored: hosts living in the included files simply were not
 * imported, and the UI reported "nothing new to import" as if the config were
 * empty. ssh treats a missing include as a no-op, so failures here are ignored
 * too — but the files that do exist must be read.
 *
 * Relative paths resolve against the main config's directory (~/.ssh), which is
 * what ssh does, not against the including file.
 */

/** Guards against `a` including `b` including `a`. */
const MAX_DEPTH = 8

/** `Include path` or `Include=path`; the keyword is case-insensitive. */
const INCLUDE_LINE = /^\s*include\s*(?:=\s*)?(.+)$/i

/** `*` and `?` only — the two OpenSSH supports for includes. */
function globToRegExp(pattern: string): RegExp {
  const body = pattern
    .split('')
    .map((c) => {
      if (c === '*') return '[^/]*'
      if (c === '?') return '[^/]'
      return c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    })
    .join('')
  return new RegExp(`^${body}$`)
}

function unquote(value: string): string {
  const v = value.trim()
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) {
    return v.slice(1, -1)
  }
  return v
}

/** Resolves one include spec (possibly a glob) to existing file paths. */
async function resolveSpec(spec: string, baseDir: string): Promise<string[]> {
  const path = isAbsolute(spec) ? spec : join(baseDir, spec)
  if (!/[*?]/.test(path)) return [path]
  const dir = dirname(path)
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const re = globToRegExp(basename(path))
  return names
    .filter((n) => re.test(n))
    .sort()
    .map((n) => join(dir, n))
}

/** Replaces every top-level `Include` with the contents of the files it names. */
export async function expandIncludes(
  text: string,
  baseDir: string,
  seen: Set<string> = new Set(),
  depth = 0
): Promise<string> {
  if (depth > MAX_DEPTH) return text
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = INCLUDE_LINE.exec(line)
    if (!m) {
      out.push(line)
      continue
    }
    const files = await resolveSpec(unquote(m[1]), baseDir)
    for (const file of files) {
      const key = resolve(file)
      if (seen.has(key)) continue
      seen.add(key)
      try {
        const inner = await readFile(file, 'utf8')
        out.push(await expandIncludes(inner, baseDir, seen, depth + 1))
      } catch {
        // ssh ignores an include it cannot open; so do we.
      }
    }
  }
  return out.join('\n')
}
