import type { Host } from './types'

/**
 * Builds an OpenSSH `~/.ssh/config` from saved hosts.
 *
 * Kept out of the store so the two failure modes that silently corrupt an
 * exported config can be tested:
 *
 * 1. **Duplicate aliases.** Two hosts labelled "web" produced two `Host web`
 *    blocks. OpenSSH keeps the first and drops the rest, and any
 *    `ProxyJump web` resolved to that first block — i.e. a jump through the
 *    wrong machine, with no error anywhere.
 * 2. **Unescaped values.** `User John Smith` or an `IdentityFile` under
 *    `C:\Users\John Smith\` splits into extra arguments; ssh aborts the whole
 *    file ("bad configuration options"), so *every* host in it stops working.
 *    A newline in `group` injected a raw config line.
 */

/** Characters that would turn a value into two arguments, or a pattern into a glob. */
const UNQUOTED_UNSAFE = /[\s"'\\]/

/** One token, free of whitespace, glob metacharacters and control characters. */
function aliasBase(h: Host): string {
  const raw = (h.label || '').trim() || (h.username ? `${h.username}@${h.host}` : h.host)
  const cleaned = raw
    // A newline would start a new directive; a tab would split the pattern.
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[*?!]/g, '-')
    // OpenSSH Host patterns are space-separated, so spaces cannot survive.
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || 'host'
}

/** Appends `-2`, `-3`… until the alias is unused, and records it. */
function uniqueAlias(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base)
    return base
  }
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
  }
}

/**
 * Quotes a config value when it would otherwise be split.
 *
 * OpenSSH accepts `"..."` around a value with spaces. Backslashes are left
 * alone on purpose: inside double quotes ssh only treats `\"` and `\\` as
 * escapes, so a Windows path keeps its single separators.
 */
export function quoteConfigValue(value: string): string {
  // A newline or CR would terminate the directive and start a new one.
  const clean = value.replace(/[\r\n]+/g, ' ').trim()
  if (!clean) return ''
  if (!UNQUOTED_UNSAFE.test(clean)) return clean
  return `"${clean.replace(/"/g, '\\"')}"`
}

/** A line `\tKey value`, or nothing when the value is empty. */
function line(key: string, value: string | number | undefined): string | null {
  if (value === undefined) return null
  const quoted = quoteConfigValue(String(value))
  if (!quoted) return null
  return `\t${key} ${quoted}`
}

/** Builds the full config text. Secrets are never exported. */
export function buildSshConfig(hosts: Host[]): string {
  const used = new Set<string>()
  const alias = new Map<string, string>()
  for (const h of hosts) alias.set(h.id, uniqueAlias(aliasBase(h), used))

  const byId = new Map(hosts.map((h) => [h.id, h]))
  const blocks = hosts.map((h) => {
    const lines: string[] = [`Host ${alias.get(h.id)}`]
    const add = (l: string | null): void => {
      if (l) lines.push(l)
    }
    add(line('HostName', h.host))
    add(line('Port', h.port || 22))
    // An empty User is a syntax error in ssh, not "use the default".
    add(line('User', h.username))
    if (h.auth === 'key' && h.keyPath) add(line('IdentityFile', h.keyPath))
    if (h.agentForward) lines.push('\tForwardAgent yes')
    if (h.x11Forward) lines.push('\tForwardX11 yes')
    if (h.jumpHostId) {
      const j = byId.get(h.jumpHostId)
      const jAlias = j && alias.get(j.id)
      if (jAlias) lines.push(`\tProxyJump ${jAlias}`)
    }
    if (h.proxy && h.proxy.type === 'http') {
      // Proxy credentials are NOT exported either — the config file gets
      // shared/committed far more casually than the secrets store.
      const target = quoteConfigValue(`${h.proxy.host}:${h.proxy.port}`)
      lines.push(`\t# ProxyCommand needs the proxy's credentials: fill in user:password yourself`)
      lines.push(`\t# ProxyCommand connect-proxy -H user:password@${target} %h %p`)
    }
    if (h.onConnect) {
      // One line only: a real newline would start a new directive.
      add(line('RemoteCommand', h.onConnect.split('\n').join(' && ')))
    }
    if (h.group) {
      const g = h.group.replace(/[\r\n]+/g, ' ')
      lines.push(`\t# group: ${g}`)
    }
    return lines.join('\n')
  })
  return blocks.join('\n\n') + '\n'
}
