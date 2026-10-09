/**
 * Pure helpers for the host online / offline probe (main/reachability.ts runs
 * it). ICMP ping goes first because it leaves nothing in the server's sshd log;
 * a TCP connect to the SSH port is only the fallback for hosts that drop ping.
 */

/** Values that are safe to hand to `ping` as its last argument: a hostname or
 *  an IPv4 / IPv6 literal. Anything starting with '-' would be read as an
 *  option, so it is refused outright (the value comes from the hosts file). */
export function isProbeableHost(host: string): boolean {
  if (!host || host.length > 253) return false
  if (host.startsWith('-')) return false
  return /^[A-Za-z0-9._:%-]+$/.test(host)
}

/** One echo request with a short wait. The wait flag differs by platform:
 *  Windows `-w` is milliseconds, macOS `-W` is milliseconds, Linux `-W` is
 *  seconds. */
export function pingArgs(platform: string, host: string): string[] {
  if (platform === 'win32') return ['-n', '1', '-w', '1500', host]
  if (platform === 'darwin') return ['-c', '1', '-W', '1500', host]
  return ['-c', '1', '-W', '2', host]
}

/** 198.18.0.0/15 is reserved for benchmarking, which is why proxy tools in
 *  TUN / fake-ip mode (Clash, mihomo, sing-box…) hand those addresses out for
 *  every hostname — and answer pings to them themselves, instantly. */
export function isFakeIp(ip: string): boolean {
  return /^198\.(18|19)\.\d{1,3}\.\d{1,3}$/.test(ip)
}

/**
 * What one ping run says:
 * - 'reply'   an echo reply from the host itself
 * - 'proxied' a reply, but from a fake-ip proxy address — says nothing about the host
 * - 'none'    no reply
 *
 * Windows ping exits 0 even for "Destination host unreachable" (a reply from
 * the gateway), so there a reply means a line carrying "TTL=" or, for IPv6
 * (which prints no TTL), a round-trip time like "time<1ms" / "时间=3ms" —
 * whatever the display language, an unreachable line has neither. Elsewhere
 * the exit code is reliable.
 */
export function pingVerdict(platform: string, exitCode: number | null, stdout: string): 'reply' | 'proxied' | 'none' {
  const replyLine = stdout.split(/\r?\n/).find((l) => /ttl=/i.test(l) || /[<=]\s?\d+(?:\.\d+)?\s?ms\b/i.test(l))
  const replied = platform === 'win32' ? !!replyLine : exitCode === 0
  if (!replied) return 'none'
  const ip = replyLine ? /(\d{1,3}(?:\.\d{1,3}){3})/.exec(replyLine)?.[1] : undefined
  return ip && isFakeIp(ip) ? 'proxied' : 'reply'
}
