import type { Host } from '../../../shared/types'

/** Does a saved host match what was typed in the library's search box?
 *  Every space-separated word must appear somewhere in the host's name, address
 *  (as people type it: host, host:port, user@host, user@host:port), group, tags
 *  or OS name. `q` is already trimmed and lower-cased by the caller. */
export function hostMatches(h: Host, q: string): boolean {
  if (!q) return true
  const port = h.port || 22
  const hay = [
    h.label,
    h.host,
    `${h.host}:${port}`,
    h.username,
    `${h.username}@${h.host}`,
    `${h.username}@${h.host}:${port}`,
    h.group ?? '',
    ...(h.tags ?? []),
    h.os?.pretty ?? ''
  ]
    .join('\n')
    .toLowerCase()
  return q
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w))
}
