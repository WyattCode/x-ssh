export interface ParsedTarget {
  username?: string
  host: string
  port: number
}

/**
 * Parses quick-connect strings like `user@host`, `host:2222`, `user@host:22`.
 * Returns null when there is no plausible hostname yet.
 */
export function parseTarget(input: string): ParsedTarget | null {
  const raw = input.trim()
  if (!raw || /\s/.test(raw)) return null

  let rest = raw
  let username: string | undefined
  const at = rest.lastIndexOf('@')
  if (at >= 0) {
    username = rest.slice(0, at) || undefined
    rest = rest.slice(at + 1)
  }

  let port = 22
  const colon = rest.lastIndexOf(':')
  if (colon >= 0) {
    const p = Number(rest.slice(colon + 1))
    if (!Number.isInteger(p) || p <= 0 || p > 65535) return null
    port = p
    rest = rest.slice(0, colon)
  }

  // Require a host that looks like a hostname or IP.
  if (!rest || !/^[a-zA-Z0-9._-]+$/.test(rest)) return null
  if (!rest.includes('.') && !username && port === 22) {
    // Bare single word with no dot/user/port is more likely a search term.
    return null
  }
  return { username, host: rest, port }
}
