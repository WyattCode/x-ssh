/**
 * Launch-target parsing shared by the main process (and unit tests). A launch
 * target is a quick-connect spec the user passes on the command line or via an
 * `x-ssh://` URL, so the app can drop straight into a connection on open.
 *
 * Keep this dependency-free so it can be imported from any layer.
 */

/** CLI switches that carry a launch target (repeatable). */
export const LAUNCH_SWITCHES = ['-c', '--connect', '--url', '--target']

/** Name of the custom URL scheme the app registers itself for. */
export const PROTOCOL = 'x-ssh'

/** Extracts a quick-connect target from a raw protocol URL (`x-ssh://user@host:port`). */
export function targetFromUrl(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== `${PROTOCOL}:`) return null
    // Rebuild the familiar `user@host:port` form from the URL's parts.
    const username = u.username ? `${u.username}@` : ''
    return `${username}${u.hostname}${u.port ? `:${u.port}` : ''}`
  } catch {
    return null
  }
}

/** Parses the command line / protocol URL into a single quick-connect target. */
export function readLaunchTarget(argv: string[]): string | null {
  for (const a of argv) {
    const url = targetFromUrl(a)
    if (url) return url
  }
  // `-c user@host` / `--connect user@host` (also accepts a trailing `=value`).
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (LAUNCH_SWITCHES.includes(a)) {
      if (argv[i + 1] && !argv[i + 1].startsWith('-')) return argv[i + 1]
    }
    for (const sw of LAUNCH_SWITCHES) {
      if (a.startsWith(`${sw}=`)) return a.slice(sw.length + 1)
    }
  }
  return null
}

/** Compares two dotted version strings; returns <0, 0, or >0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d
  }
  return 0
}
