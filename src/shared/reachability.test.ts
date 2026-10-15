import { describe, it, expect } from 'vitest'
import {
  isFakeIp,
  isProbeableHost,
  pingArgs,
  pingVerdict,
  SSH_PROBE_COOLDOWN_MS,
  sshProbeCoolingDown,
  sshProbeOutcome,
} from './reachability'

describe('isProbeableHost', () => {
  it('accepts hostnames and IP literals', () => {
    for (const h of ['192.168.10.229', 'dgx-spark.local', 'example.com', 'fe80::1%eth0', '::1']) {
      expect(isProbeableHost(h), h).toBe(true)
    }
  })
  it('refuses anything ping could read as an option or that holds odd characters', () => {
    for (const h of ['', '-n', '--help', 'a b', 'host;rm', 'x'.repeat(254), '$(id)']) {
      expect(isProbeableHost(h), h).toBe(false)
    }
  })
})

describe('pingArgs', () => {
  it('sends one request with a short, platform-correct wait and the host last', () => {
    expect(pingArgs('win32', 'h')).toEqual(['-n', '1', '-w', '1500', 'h'])
    expect(pingArgs('darwin', 'h')).toEqual(['-c', '1', '-W', '1500', 'h'])
    expect(pingArgs('linux', 'h')).toEqual(['-c', '1', '-W', '2', 'h'])
  })
})

describe('pingVerdict', () => {
  it('on Windows needs a real echo reply, not just exit code 0', () => {
    expect(pingVerdict('win32', 0, 'Reply from 192.168.10.1: bytes=32 time<1ms TTL=64')).toBe('reply')
    expect(pingVerdict('win32', 0, '来自 192.168.10.1 的回复: 字节=32 时间<1ms TTL=64')).toBe('reply')
    // Gateway answers "unreachable" and ping still exits 0.
    expect(pingVerdict('win32', 0, 'Reply from 192.168.10.1: Destination host unreachable.')).toBe('none')
    expect(pingVerdict('win32', 1, 'Request timed out.')).toBe('none')
  })
  it('on Windows counts IPv6 replies, which carry no TTL', () => {
    expect(pingVerdict('win32', 0, 'Reply from ::1: time<1ms')).toBe('reply')
    expect(pingVerdict('win32', 0, '来自 2001:db8::5 的回复: 时间=12ms')).toBe('reply')
    expect(pingVerdict('win32', 0, '来自 192.168.10.1 的回复: 无法访问目标主机。')).toBe('none')
  })
  it('elsewhere trusts the exit code', () => {
    expect(pingVerdict('linux', 0, '64 bytes from 10.0.0.5: icmp_seq=1 ttl=64 time=0.3 ms')).toBe('reply')
    expect(pingVerdict('darwin', 2, '')).toBe('none')
    expect(pingVerdict('linux', null, '')).toBe('none')
  })
  it('does not count a fake-ip proxy answering for the host', () => {
    const out = 'Pinging example.com [198.18.10.178] with 32 bytes of data:\r\nReply from 198.18.10.178: bytes=32 time<1ms TTL=126'
    expect(pingVerdict('win32', 0, out)).toBe('proxied')
    expect(pingVerdict('linux', 0, '64 bytes from 198.19.0.1: icmp_seq=1 ttl=64')).toBe('proxied')
    expect(pingVerdict('win32', 0, 'Reply from 198.20.0.1: bytes=32 time=3ms TTL=50')).toBe('reply')
  })
})

describe('isFakeIp', () => {
  it('matches 198.18.0.0/15 only', () => {
    expect(isFakeIp('198.18.0.1')).toBe(true)
    expect(isFakeIp('198.19.255.254')).toBe(true)
    expect(isFakeIp('198.17.0.1')).toBe(false)
    expect(isFakeIp('198.20.0.1')).toBe(false)
    expect(isFakeIp('10.198.18.1')).toBe(false)
  })
})

describe('sshProbeOutcome', () => {
  it('counts any far-end data as sshd being up, refusal as a closed port, the rest as down', () => {
    expect(sshProbeOutcome('data')).toBe('open')
    expect(sshProbeOutcome('refused')).toBe('closed')
    expect(sshProbeOutcome('down')).toBe('down')
  })
})

describe('sshProbeCoolingDown', () => {
  const now = 1_000_000
  it('cools a host whose probe saw sshd, within the window', () => {
    expect(sshProbeCoolingDown({ at: now - 60_000, outcome: 'open' }, now)).toBe(true)
  })
  it('does not cool refused / timed-out probes — nothing answered, nothing to feed', () => {
    expect(sshProbeCoolingDown({ at: now - 1_000, outcome: 'closed' }, now)).toBe(false)
    expect(sshProbeCoolingDown({ at: now - 1_000, outcome: 'down' }, now)).toBe(false)
  })
  it('lets the cooldown expire', () => {
    expect(sshProbeCoolingDown({ at: now - SSH_PROBE_COOLDOWN_MS - 1, outcome: 'open' }, now)).toBe(false)
  })
  it('never cools a host that has not been probed on the SSH port', () => {
    expect(sshProbeCoolingDown(undefined, now)).toBe(false)
  })
})
