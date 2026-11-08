import type { HostForward } from '../shared/types'

/**
 * A single-pass parser for the OpenSSH `~/.ssh/config` blocks people actually
 * write. Kept out of index.ts so the edge cases can be tested: the previous
 * inline version took only the first name of `Host a b c`, attached `Match`
 * directives to the previous block, dropped everything under `Host *` and
 * ignored the `Key=value` spelling OpenSSH also accepts.
 *
 * Semantics that matter:
 * - Within a block the FIRST value wins (`User root` then `User bob` → root).
 * - `Host *` supplies defaults for every block; a block's own value still wins.
 * - `Match` is a conditional block, not a host: its directives must not leak
 *   into the preceding block.
 * - A `#` only starts a comment at the beginning of a line, so `key#1` in a
 *   path survives.
 */

export interface SshConfigHost {
  /** The alias from the `Host` line (the name the user types). */
  host: string
  /** `HostName`; when absent the alias itself is the address. */
  hostname?: string
  user?: string
  port?: number
  identityFile?: string
  proxyJump?: string
  agentForward?: boolean
  x11Forward?: boolean
  forwards?: HostForward[]
}

/** `Key value` or the equally valid `Key=value`. */
const KEYLINE = /^([A-Za-z][\w]*)\s*(?:=\s*|\s+)(.*)$/

/** A pattern that would match several hosts; not importable as one host. */
function isPattern(name: string): boolean {
  return name === '*' || name.startsWith('!') || /[*?]/.test(name)
}

/** `~` and `~/…` expand against the user's home, as ssh does. */
function expandTilde(value: string, home: string): string {
  if (value === '~') return home
  if (value.startsWith('~/') || value.startsWith('~\\')) return home + value.slice(1)
  return value
}

type Draft = Omit<SshConfigHost, 'host'>

/** First-wins: OpenSSH keeps the value it saw first for each keyword. */
function setOnce<K extends keyof Draft>(target: Draft, key: K, value: Draft[K]): void {
  if (target[key] === undefined) target[key] = value
}

export function parseSshConfig(raw: string, home = ''): SshConfigHost[] {
  const out: SshConfigHost[] = []
  /** Values from `Host *`, applied to blocks that do not set their own. */
  const defaults: Draft = {}
  let current: Draft | null = null
  let currentName: string | null = null
  /** Where directives currently go: a Host block, the `*` defaults, or nowhere. */
  let mode: 'host' | 'defaults' | 'none' = 'none'

  const flush = (): void => {
    if (current && currentName) out.push({ host: currentName, ...current })
    current = null
    currentName = null
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    // A comment only when `#` is the first non-blank character; `IdentityFile
    // ~/.ssh/key#1` is a valid path and must not be cut.
    if (!trimmed || trimmed.startsWith('#')) continue
    const m = KEYLINE.exec(trimmed)
    if (!m) continue
    const key = m[1].toLowerCase()
    const rest = m[2].trim()

    if (key === 'host') {
      flush()
      const names = rest
        .split(/\s+/)
        .map((n) => n.trim())
        .filter(Boolean)
      const literal = names.find((n) => !isPattern(n))
      if (literal) {
        current = {}
        currentName = literal
        mode = 'host'
      } else if (names.length) {
        // `Host *` (or only negations/globs): its directives are defaults.
        mode = 'defaults'
      } else {
        mode = 'none'
      }
      continue
    }

    if (key === 'match') {
      // A conditional block is not a host — do not attach its directives to
      // the block that happened to precede it.
      flush()
      mode = 'none'
      continue
    }

    if (mode === 'none') continue
    const target = mode === 'defaults' ? defaults : current
    if (!target) continue

    switch (key) {
      case 'hostname':
        setOnce(target, 'hostname', rest)
        break
      case 'user':
        setOnce(target, 'user', rest)
        break
      case 'port': {
        const n = Number(rest.split(/\s+/)[0])
        if (n > 0 && n < 65536) setOnce(target, 'port', n)
        break
      }
      case 'identityfile':
        setOnce(target, 'identityFile', expandTilde(rest, home))
        break
      case 'proxyjump': {
        // "none" means "no jump at all". Recorded as '' so it can override a
        // `Host *` default instead of being mistaken for "unset".
        const first = rest.split(',')[0].trim()
        if (target.proxyJump === undefined) {
          target.proxyJump = /^none$/i.test(first) ? '' : first
        }
        break
      }
      case 'forwardagent':
        // `no`, `none` and a host list all disable it.
        setOnce(target, 'agentForward', /^yes/i.test(rest))
        break
      case 'forwardx11':
        setOnce(target, 'x11Forward', /^yes/i.test(rest))
        break
      case 'localforward': {
        // "LocalForward [bind:]port host:port"; the bind address is ignored
        // (we always listen on localhost).
        const parts = rest.split(/\s+/)
        const target0 = parts[1]
        if (!target0) break
        const lp = Number(parts[0].split(':').pop()) || 0
        const tm = /^(.*?):(\d+)$/.exec(target0)
        if (!lp || !tm) break
        // Forwards accumulate rather than first-wins: several are normal.
        // They are intentionally NOT inherited from `Host *` (adding the same
        // forward to every host would collide on the listen port).
        if (mode !== 'host') break
        target.forwards = target.forwards ?? []
        target.forwards.push({
          mode: 'local',
          localPort: lp,
          remoteHost: tm[1] || '',
          remotePort: Number(tm[2])
        })
        break
      }
    }
  }
  flush()

  // Apply `Host *` defaults to anything the block left unset. An empty
  // proxyJump is an explicit "no jump" and must not be replaced by a default.
  return out.map((h) => ({
    ...h,
    hostname: h.hostname ?? defaults.hostname,
    user: h.user ?? defaults.user,
    port: h.port ?? defaults.port,
    identityFile: h.identityFile ?? defaults.identityFile,
    proxyJump: h.proxyJump !== undefined ? h.proxyJump || undefined : defaults.proxyJump || undefined,
    agentForward: h.agentForward ?? defaults.agentForward,
    x11Forward: h.x11Forward ?? defaults.x11Forward
  }))
}
